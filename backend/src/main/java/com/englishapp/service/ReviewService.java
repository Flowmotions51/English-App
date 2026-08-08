package com.englishapp.service;

import com.englishapp.model.*;
import com.englishapp.repository.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.*;
import java.util.*;
import java.util.stream.Collectors;

@Service
public class ReviewService {
    private static final int MAX_SENTENCES_PER_REVIEW_SESSION = 15;
    private static final int MAX_WEEKLY_CATCH_UP_SENTENCES = 30;

    private final SentenceRepository sentenceRepository;
    private final ScheduleTemplateRepository scheduleTemplateRepository;
    private final SentenceReviewRepository sentenceReviewRepository;
    private final ReviewSessionRepository reviewSessionRepository;
    private final ReviewSessionItemRepository reviewSessionItemRepository;
    private final ReviewNotificationRepository reviewNotificationRepository;

    public ReviewService(
            SentenceRepository sentenceRepository,
            ScheduleTemplateRepository scheduleTemplateRepository,
            SentenceReviewRepository sentenceReviewRepository,
            ReviewSessionRepository reviewSessionRepository,
            ReviewSessionItemRepository reviewSessionItemRepository,
            ReviewNotificationRepository reviewNotificationRepository
    ) {
        this.sentenceRepository = sentenceRepository;
        this.scheduleTemplateRepository = scheduleTemplateRepository;
        this.sentenceReviewRepository = sentenceReviewRepository;
        this.reviewSessionRepository = reviewSessionRepository;
        this.reviewSessionItemRepository = reviewSessionItemRepository;
        this.reviewNotificationRepository = reviewNotificationRepository;
    }

    @Transactional
    public void refreshPendingSessions(UserAccount user) {
        List<Sentence> sentences = sentenceRepository.findAllByUserId(user.getId());

        Map<Long, ScheduleTemplate> scheduleBySentence = scheduleTemplateRepository.findBySentenceSentenceListUserId(user.getId())
                .stream()
                .collect(HashMap::new, (map, schedule) -> map.put(schedule.getSentence().getId(), schedule), HashMap::putAll);
        Map<Long, Long> reviewCounts = sentenceReviewRepository.countReviewsBySentenceForUserAsMap(user.getId());
        Map<Long, Instant> lastReviewedAt = sentenceReviewRepository.lastReviewedAtBySentenceForUserAsMap(user.getId());
        List<DueSentence> dueSentences = new ArrayList<>();
        Instant now = Instant.now();
        ZoneId zoneId = parseZone(user.getTimezone());

        List<PlannedSession> plannedSessions = new ArrayList<>();
        plannedSessions.addAll(planInitialReviewSessions(sentences, reviewCounts, now, user.getMergeWindowMinutes()));

        for (Sentence sentence : sentences) {
            ScheduleTemplate schedule = scheduleBySentence.get(sentence.getId());
            if (schedule == null || schedule.getSteps().isEmpty()) {
                continue;
            }
            Instant resetAt = sentence.getScheduleResetAt();
            long reviewed = resetAt != null
                    ? sentenceReviewRepository.countBySentence_IdAndUser_IdAndReviewedAtGreaterThanEqual(sentence.getId(), user.getId(), resetAt)
                    : reviewCounts.getOrDefault(sentence.getId(), 0L);
            // Sentences with zero total reviews are surfaced immediately by planInitialReviewSessions
            // instead. But a sentence with a reset anchor (excluded then re-included) already has
            // review history, so it's never picked up there — it must be handled here even when its
            // reset-scoped review count is 0 (its first occurrence since the reset).
            if (reviewed == 0L && resetAt == null) {
                continue;
            }
            Instant anchor = resetAt != null ? resetAt : sentence.getCreatedAt();
            Instant lastReviewForSentence = resetAt != null
                    ? sentenceReviewRepository.lastReviewedAtForSentenceSince(sentence.getId(), user.getId(), resetAt)
                    : lastReviewedAt.get(sentence.getId());
            Instant dueAt = SchedulePlanner.occurrenceAt(
                    schedule,
                    anchor,
                    lastReviewForSentence,
                    reviewed
            );
            if (dueAt == null || dueAt.isAfter(now)) {
                continue;
            }
            boolean weeklyCadence = reviewed >= schedule.getSteps().size() && schedule.isOpenEnded();
            dueSentences.add(new DueSentence(sentence, dueAt, weeklyCadence));
        }

        if (!dueSentences.isEmpty()) {
            Map<Instant, List<DueSentence>> grouped = new TreeMap<>();
            int mergeWindow = user.getMergeWindowMinutes();
            for (DueSentence dueSentence : dueSentences) {
                Instant start = dueSentence.weeklyCadence()
                        ? SchedulePlanner.weeklyMergedStart(dueSentence.dueAt(), user.getWeeklyReviewDay(), zoneId)
                        : SchedulePlanner.floorByWindow(dueSentence.dueAt(), mergeWindow);
                grouped.computeIfAbsent(start, ignored -> new ArrayList<>()).add(dueSentence);
            }

            for (Map.Entry<Instant, List<DueSentence>> entry : grouped.entrySet()) {
                List<DueSentence> inBucket = entry.getValue();
                Instant windowStart = entry.getKey();
                for (int offset = 0; offset < inBucket.size(); offset += MAX_SENTENCES_PER_REVIEW_SESSION) {
                    int end = Math.min(offset + MAX_SENTENCES_PER_REVIEW_SESSION, inBucket.size());
                    List<DueSentence> chunk = clusterByMeaningGroup(inBucket.subList(offset, end));
                    plannedSessions.add(new PlannedSession(
                            ReviewSessionKind.REGULAR,
                            windowStart,
                            windowStart.plus(Duration.ofMinutes(mergeWindow)),
                            chunk
                    ));
                }
            }
        }

        planWeeklyCatchUpSession(sentences, reviewCounts, lastReviewedAt, now, zoneId, user.getWeeklyReviewDay())
                .ifPresent(plannedSessions::add);

        reconcilePendingSessions(user, plannedSessions);
    }

    /**
     * Keeps existing PENDING sessions whose sentence set is unchanged (same kind, same sentences) so
     * that ids/notification read-state survive repeated refresh calls (login, page load, other-session
     * completion). Only sessions whose sentence set actually changed are deleted/recreated.
     */
    private void reconcilePendingSessions(UserAccount user, List<PlannedSession> plannedSessions) {
        List<ReviewSession> existingSessions = reviewSessionRepository
                .findByUserIdAndStatusOrderByStartAtAscIdAsc(user.getId(), ReviewSessionStatus.PENDING);
        Map<String, ReviewSession> existingByKey = new HashMap<>();
        if (!existingSessions.isEmpty()) {
            List<Long> existingSessionIds = existingSessions.stream().map(ReviewSession::getId).toList();
            Map<Long, List<Long>> sentenceIdsBySessionId = reviewSessionItemRepository.findByReviewSessionIdIn(existingSessionIds).stream()
                    .collect(Collectors.groupingBy(
                            item -> item.getReviewSession().getId(),
                            Collectors.mapping(item -> item.getSentence().getId(), Collectors.toList())
                    ));
            for (ReviewSession session : existingSessions) {
                List<Long> sentenceIds = sentenceIdsBySessionId.getOrDefault(session.getId(), List.of());
                existingByKey.put(sessionKey(session.getKind(), sentenceIds), session);
            }
        }

        for (PlannedSession planned : plannedSessions) {
            List<Long> sentenceIds = planned.items().stream().map(d -> d.sentence().getId()).toList();
            ReviewSession existing = existingByKey.remove(sessionKey(planned.kind(), sentenceIds));
            if (existing == null) {
                persistPlannedSession(user, planned);
            }
        }

        if (!existingByKey.isEmpty()) {
            List<ReviewSession> staleSessions = new ArrayList<>(existingByKey.values());
            List<Long> staleSessionIds = staleSessions.stream().map(ReviewSession::getId).toList();
            reviewNotificationRepository.deleteAll(reviewNotificationRepository.findByReviewSessionIdIn(staleSessionIds));
            reviewSessionRepository.deleteAll(staleSessions);
        }
    }

    private String sessionKey(ReviewSessionKind kind, List<Long> sentenceIds) {
        String sortedIds = sentenceIds.stream()
                .sorted()
                .map(String::valueOf)
                .reduce((a, b) -> a + "," + b)
                .orElse("");
        return kind.name() + "|" + sortedIds;
    }

    private void persistPlannedSession(UserAccount user, PlannedSession planned) {
        ReviewSession session = new ReviewSession();
        session.setUser(user);
        session.setStartAt(planned.startAt());
        session.setEndAt(planned.endAt());
        session.setStatus(ReviewSessionStatus.PENDING);
        session.setKind(planned.kind());
        session = reviewSessionRepository.save(session);

        for (DueSentence dueSentence : planned.items()) {
            ReviewSessionItem item = new ReviewSessionItem();
            item.setReviewSession(session);
            item.setSentence(dueSentence.sentence());
            item.setDueAt(dueSentence.dueAt());
            reviewSessionItemRepository.save(item);
        }

        ReviewNotification notification = new ReviewNotification();
        notification.setUser(user);
        notification.setReviewSession(session);
        notification.setRead(false);
        reviewNotificationRepository.save(notification);
    }

    private List<PlannedSession> planInitialReviewSessions(
            List<Sentence> sentences,
            Map<Long, Long> reviewCounts,
            Instant now,
            int mergeWindowMinutes
    ) {
        List<Sentence> unreviewed = sentences.stream()
                .filter(sentence -> reviewCounts.getOrDefault(sentence.getId(), 0L) == 0L)
                .sorted(Comparator
                        .comparing(Sentence::getCreatedAt)
                        .thenComparing(Sentence::getId))
                .toList();

        List<PlannedSession> planned = new ArrayList<>();
        for (int offset = 0; offset < unreviewed.size(); offset += MAX_SENTENCES_PER_REVIEW_SESSION) {
            int end = Math.min(offset + MAX_SENTENCES_PER_REVIEW_SESSION, unreviewed.size());
            List<DueSentence> chunk = clusterByMeaningGroup(unreviewed.subList(offset, end).stream()
                    .map(sentence -> new DueSentence(sentence, sentence.getCreatedAt(), false))
                    .toList());
            planned.add(new PlannedSession(
                    ReviewSessionKind.INITIAL,
                    now,
                    now.plus(Duration.ofMinutes(mergeWindowMinutes)),
                    chunk
            ));
        }
        return planned;
    }

    @Transactional(readOnly = true)
    public List<Map<String, Object>> pendingSessions(UserAccount user) {
        List<ReviewSession> sessions = reviewSessionRepository
                .findByUserIdAndStatusOrderByStartAtAscIdAsc(user.getId(), ReviewSessionStatus.PENDING);
        if (sessions.isEmpty()) {
            return List.of();
        }
        List<Long> sessionIds = sessions.stream().map(ReviewSession::getId).toList();
        Map<Long, List<ReviewSessionItem>> itemsBySessionId = reviewSessionItemRepository.findByReviewSessionIdIn(sessionIds).stream()
                .collect(Collectors.groupingBy(item -> item.getReviewSession().getId()));
        Map<Long, Boolean> notificationReadBySessionId = reviewNotificationRepository.findByReviewSessionIdIn(sessionIds).stream()
                .collect(Collectors.toMap(n -> n.getReviewSession().getId(), ReviewNotification::isRead));
        Instant now = Instant.now();
        return sessions.stream().map(session -> {
            List<ReviewSessionItem> sessionItems = itemsBySessionId.getOrDefault(session.getId(), List.of());
            List<Map<String, Object>> items = clusterSessionItemsByMeaningGroup(sessionItems).stream()
                    .map(this::sessionItemPayload)
                    .toList();
            boolean notificationRead = notificationReadBySessionId.getOrDefault(session.getId(), true);
            return Map.<String, Object>of(
                    "id", session.getId(),
                    "startAt", session.getStartAt(),
                    "endAt", session.getEndAt(),
                    "isDueNow", !session.getStartAt().isAfter(now),
                    "notificationRead", notificationRead,
                    "kind", session.getKind().name(),
                    "items", items
            );
        }).toList();
    }

    @Transactional
    public void openSession(UserAccount user, Long sessionId) {
        ReviewSession session = reviewSessionRepository.findByIdAndUserId(sessionId, user.getId())
                .orElseThrow(() -> new NotFoundException("Review session not found"));
        if (session.getStatus() != ReviewSessionStatus.PENDING) {
            throw new IllegalArgumentException("Session is not pending");
        }
        if (session.getKind() == ReviewSessionKind.WEEKLY_CATCH_UP) {
            return;
        }
        reviewNotificationRepository.findByReviewSessionId(sessionId).ifPresent(notification -> {
            notification.setRead(true);
            reviewNotificationRepository.save(notification);
        });
    }

    @Transactional
    public int completeSession(UserAccount user, Long sessionId, List<Long> sentenceIds) {
        ReviewSession session = reviewSessionRepository.findByIdAndUserId(sessionId, user.getId())
                .orElseThrow(() -> new NotFoundException("Review session not found"));
        if (session.getStatus() != ReviewSessionStatus.PENDING) {
            throw new IllegalArgumentException("Session is already completed");
        }

        List<ReviewSessionItem> items = reviewSessionItemRepository.findByReviewSessionId(sessionId);
        Set<Long> targetSentenceIds = sentenceIds != null ? new HashSet<>(sentenceIds) : null;
        Instant now = Instant.now();
        int remaining = 0;
        for (ReviewSessionItem item : items) {
            if (targetSentenceIds != null && !targetSentenceIds.contains(item.getSentence().getId())) {
                remaining++;
                continue;
            }
            SentenceReview sentenceReview = new SentenceReview();
            sentenceReview.setUser(user);
            sentenceReview.setSentence(item.getSentence());
            sentenceReview.setReviewSession(session);
            sentenceReview.setReviewedAt(now);
            sentenceReviewRepository.save(sentenceReview);
            reviewSessionItemRepository.delete(item);
            maybeAutoExcludeAfterReview(user, item.getSentence());
        }

        if (remaining == 0) {
            session.setStatus(ReviewSessionStatus.COMPLETED);
            reviewSessionRepository.save(session);
            reviewNotificationRepository.findByReviewSessionId(sessionId).ifPresent(notification -> {
                notification.setRead(true);
                reviewNotificationRepository.save(notification);
            });
        }
        return remaining;
    }

    @Transactional
    public Map<String, Object> completeSentenceFromListReview(UserAccount user, Long sentenceId) {
        Sentence sentence = sentenceRepository.findByIdAndUser(sentenceId, user.getId())
                .orElseThrow(() -> new NotFoundException("Sentence not found"));
        Instant now = Instant.now();
        long reviewCount = sentenceReviewRepository.countBySentence_IdAndUser_Id(sentenceId, user.getId());
        if (sentence.isExcludedFromSchedule()) {
            return Map.<String, Object>of(
                    "recorded", false,
                    "reason", "EXCLUDED",
                    "reviewCount", reviewCount
            );
        }
        Instant resetAt = sentence.getScheduleResetAt();
        long effectiveReviewCount = resetAt != null
                ? sentenceReviewRepository.countBySentence_IdAndUser_IdAndReviewedAtGreaterThanEqual(sentenceId, user.getId(), resetAt)
                : reviewCount;
        Instant dueAt = null;
        String reason = "NOT_DUE";
        boolean shouldRecord = effectiveReviewCount == 0L;
        if (shouldRecord) {
            reason = "INITIAL";
        } else {
            Optional<ScheduleTemplate> schedule = scheduleTemplateRepository.findBySentenceId(sentenceId);
            if (schedule.isEmpty()) {
                reason = "NO_SCHEDULE";
            } else {
                Instant anchor = resetAt != null ? resetAt : sentence.getCreatedAt();
                Instant lastReviewAt = resetAt != null
                        ? sentenceReviewRepository.lastReviewedAtForSentenceSince(sentenceId, user.getId(), resetAt)
                        : sentenceReviewRepository.lastReviewedAtForSentence(sentenceId, user.getId());
                dueAt = SchedulePlanner.occurrenceAt(
                        schedule.get(),
                        anchor,
                        lastReviewAt,
                        effectiveReviewCount
                );
                shouldRecord = dueAt != null && !dueAt.isAfter(now);
                if (shouldRecord) {
                    reason = "DUE";
                }
            }
        }

        if (!shouldRecord) {
            return Map.<String, Object>of(
                    "recorded", false,
                    "reason", reason,
                    "reviewCount", reviewCount
            );
        }

        SentenceReview sentenceReview = new SentenceReview();
        sentenceReview.setUser(user);
        sentenceReview.setSentence(sentence);
        sentenceReview.setReviewedAt(now);
        sentenceReviewRepository.saveAndFlush(sentenceReview);
        maybeAutoExcludeAfterReview(user, sentence);
        refreshPendingSessions(user);

        return Map.<String, Object>of(
                "recorded", true,
                "reason", reason,
                "reviewCount", reviewCount + 1,
                "reviewedAt", now,
                "dueAt", dueAt != null ? dueAt : sentence.getCreatedAt()
        );
    }

    /** Auto-excludes a sentence once its (reset-aware) review count reaches the user's configured threshold. */
    private void maybeAutoExcludeAfterReview(UserAccount user, Sentence sentence) {
        if (sentence.isExcludedFromSchedule()) {
            return;
        }
        Integer threshold = user.getAutoExcludeAfterReviews();
        if (threshold == null || threshold <= 0) {
            return;
        }
        Instant resetAt = sentence.getScheduleResetAt();
        long effectiveReviewCount = resetAt != null
                ? sentenceReviewRepository.countBySentence_IdAndUser_IdAndReviewedAtGreaterThanEqual(sentence.getId(), user.getId(), resetAt)
                : sentenceReviewRepository.countBySentence_IdAndUser_Id(sentence.getId(), user.getId());
        if (effectiveReviewCount >= threshold) {
            sentence.setExcludedFromSchedule(true);
        }
    }

    private ZoneId parseZone(String timezone) {
        try {
            return ZoneId.of(timezone);
        } catch (Exception ignored) {
            return ZoneOffset.UTC;
        }
    }

    private Optional<PlannedSession> planWeeklyCatchUpSession(
            List<Sentence> sentences,
            Map<Long, Long> reviewCounts,
            Map<Long, Instant> lastReviewedAt,
            Instant now,
            ZoneId zoneId,
            int weeklyReviewDay
    ) {
        if (sentences.isEmpty()) {
            return Optional.empty();
        }
        Instant weekStart = weeklyCatchUpStart(now, weeklyReviewDay, zoneId);
        if (weekStart.isAfter(now)) {
            return Optional.empty();
        }

        List<Sentence> leastReviewed = sentences.stream()
                .filter(sentence -> reviewCounts.getOrDefault(sentence.getId(), 0L) > 0L)
                .sorted(Comparator
                        .comparingLong((Sentence sentence) -> reviewCounts.getOrDefault(sentence.getId(), 0L))
                        .thenComparing(
                                sentence -> lastReviewedAt.get(sentence.getId()),
                                Comparator.nullsFirst(Comparator.naturalOrder())
                        )
                        .thenComparing(Sentence::getCreatedAt)
                        .thenComparing(Sentence::getId))
                .limit(MAX_WEEKLY_CATCH_UP_SENTENCES)
                .toList();

        if (leastReviewed.isEmpty()) {
            return Optional.empty();
        }

        List<DueSentence> items = leastReviewed.stream()
                .map(sentence -> new DueSentence(sentence, weekStart, false))
                .toList();
        return Optional.of(new PlannedSession(
                ReviewSessionKind.WEEKLY_CATCH_UP,
                weekStart,
                weekStart.plus(Duration.ofDays(7)),
                items
        ));
    }

    private Instant weeklyCatchUpStart(Instant now, int weeklyReviewDay, ZoneId zoneId) {
        DayOfWeek dayOfWeek = DayOfWeek.of(Math.max(1, Math.min(7, weeklyReviewDay)));
        ZonedDateTime nowZoned = now.atZone(zoneId);
        ZonedDateTime start = nowZoned
                .with(java.time.temporal.TemporalAdjusters.previousOrSame(dayOfWeek))
                .withHour(9)
                .withMinute(0)
                .withSecond(0)
                .withNano(0);
        if (start.isAfter(nowZoned)) {
            start = start.minusWeeks(1);
        }
        return start.toInstant();
    }

    private Map<String, Object> sessionItemPayload(ReviewSessionItem item) {
        Sentence sentence = item.getSentence();
        MeaningGroup meaningGroup = sentence.getMeaningGroup();
        Map<String, Object> payload = new HashMap<>();
        payload.put("sentenceId", sentence.getId());
        payload.put("listId", sentence.getSentenceList().getId());
        payload.put("listName", sentence.getSentenceList().getName());
        payload.put("content", sentence.getContent());
        payload.put("dueAt", item.getDueAt());
        payload.put("meaningGroupId", meaningGroup != null ? meaningGroup.getId() : null);
        payload.put("meaningGroupLabel", meaningGroup != null ? meaningGroup.getLabel() : null);
        return payload;
    }

    private List<DueSentence> clusterByMeaningGroup(List<DueSentence> input) {
        if (input.size() <= 1) {
            return input;
        }
        Map<Long, List<DueSentence>> byGroup = new HashMap<>();
        for (DueSentence dueSentence : input) {
            MeaningGroup meaningGroup = dueSentence.sentence().getMeaningGroup();
            if (meaningGroup != null) {
                byGroup.computeIfAbsent(meaningGroup.getId(), ignored -> new ArrayList<>()).add(dueSentence);
            }
        }
        List<DueSentence> clustered = new ArrayList<>();
        Set<Long> emittedGroups = new HashSet<>();
        for (DueSentence dueSentence : input) {
            MeaningGroup meaningGroup = dueSentence.sentence().getMeaningGroup();
            if (meaningGroup == null) {
                clustered.add(dueSentence);
            } else if (!emittedGroups.contains(meaningGroup.getId())) {
                clustered.addAll(byGroup.get(meaningGroup.getId()));
                emittedGroups.add(meaningGroup.getId());
            }
        }
        return clustered;
    }

    private List<ReviewSessionItem> clusterSessionItemsByMeaningGroup(List<ReviewSessionItem> items) {
        if (items.size() <= 1) {
            return items;
        }
        Map<Long, List<ReviewSessionItem>> byGroup = new HashMap<>();
        for (ReviewSessionItem item : items) {
            MeaningGroup meaningGroup = item.getSentence().getMeaningGroup();
            if (meaningGroup != null) {
                byGroup.computeIfAbsent(meaningGroup.getId(), ignored -> new ArrayList<>()).add(item);
            }
        }
        List<ReviewSessionItem> clustered = new ArrayList<>();
        Set<Long> emittedGroups = new HashSet<>();
        for (ReviewSessionItem item : items) {
            MeaningGroup meaningGroup = item.getSentence().getMeaningGroup();
            if (meaningGroup == null) {
                clustered.add(item);
            } else if (!emittedGroups.contains(meaningGroup.getId())) {
                clustered.addAll(byGroup.get(meaningGroup.getId()));
                emittedGroups.add(meaningGroup.getId());
            }
        }
        return clustered;
    }

    private record DueSentence(Sentence sentence, Instant dueAt, boolean weeklyCadence) {
    }

    private record PlannedSession(ReviewSessionKind kind, Instant startAt, Instant endAt, List<DueSentence> items) {
    }
}
