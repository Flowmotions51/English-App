package com.englishapp.service;

import com.englishapp.model.*;
import com.englishapp.repository.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.*;
import java.util.*;

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
        reviewNotificationRepository.deleteByUserId(user.getId());
        reviewSessionRepository.deleteByUserIdAndStatus(user.getId(), ReviewSessionStatus.PENDING);

        List<Sentence> sentences = sentenceRepository.findAllByUserId(user.getId());
        if (sentences.isEmpty()) {
            return;
        }

        Map<Long, ScheduleTemplate> scheduleBySentence = scheduleTemplateRepository.findBySentenceSentenceListUserId(user.getId())
                .stream()
                .collect(HashMap::new, (map, schedule) -> map.put(schedule.getSentence().getId(), schedule), HashMap::putAll);
        Map<Long, Long> reviewCounts = sentenceReviewRepository.countReviewsBySentenceForUserAsMap(user.getId());
        Map<Long, Instant> lastReviewedAt = sentenceReviewRepository.lastReviewedAtBySentenceForUserAsMap(user.getId());
        List<DueSentence> dueSentences = new ArrayList<>();
        Instant now = Instant.now();
        ZoneId zoneId = parseZone(user.getTimezone());

        for (Sentence sentence : sentences) {
            ScheduleTemplate schedule = scheduleBySentence.get(sentence.getId());
            if (schedule == null || schedule.getSteps().isEmpty()) {
                continue;
            }
            long reviewed = reviewCounts.getOrDefault(sentence.getId(), 0L);
            Instant dueAt = SchedulePlanner.occurrenceAt(
                    schedule,
                    sentence.getCreatedAt(),
                    lastReviewedAt.get(sentence.getId()),
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

                    ReviewSession session = new ReviewSession();
                    session.setUser(user);
                    session.setStartAt(windowStart);
                    session.setEndAt(windowStart.plus(Duration.ofMinutes(mergeWindow)));
                    session.setStatus(ReviewSessionStatus.PENDING);
                    session.setKind(ReviewSessionKind.REGULAR);
                    session = reviewSessionRepository.save(session);

                    for (DueSentence dueSentence : chunk) {
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
            }
        }

        createWeeklyCatchUpSession(user, sentences, reviewCounts, lastReviewedAt, now, zoneId);
    }

    @Transactional(readOnly = true)
    public List<Map<String, Object>> pendingSessions(UserAccount user) {
        List<ReviewSession> sessions = reviewSessionRepository
                .findByUserIdAndStatusOrderByStartAtAscIdAsc(user.getId(), ReviewSessionStatus.PENDING);
        Instant now = Instant.now();
        return sessions.stream().map(session -> {
            List<ReviewSessionItem> sessionItems = reviewSessionItemRepository.findByReviewSessionId(session.getId());
            List<Map<String, Object>> items = clusterSessionItemsByMeaningGroup(sessionItems).stream()
                    .map(this::sessionItemPayload)
                    .toList();
            boolean notificationRead = reviewNotificationRepository.findByReviewSessionId(session.getId())
                    .map(ReviewNotification::isRead)
                    .orElse(true);
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
    public void completeSession(UserAccount user, Long sessionId) {
        ReviewSession session = reviewSessionRepository.findByIdAndUserId(sessionId, user.getId())
                .orElseThrow(() -> new NotFoundException("Review session not found"));
        if (session.getStatus() != ReviewSessionStatus.PENDING) {
            throw new IllegalArgumentException("Session is already completed");
        }

        List<ReviewSessionItem> items = reviewSessionItemRepository.findByReviewSessionId(sessionId);
        Instant now = Instant.now();
        for (ReviewSessionItem item : items) {
            SentenceReview sentenceReview = new SentenceReview();
            sentenceReview.setUser(user);
            sentenceReview.setSentence(item.getSentence());
            sentenceReview.setReviewSession(session);
            sentenceReview.setReviewedAt(now);
            sentenceReviewRepository.save(sentenceReview);
        }
        session.setStatus(ReviewSessionStatus.COMPLETED);
        reviewSessionRepository.save(session);
        reviewNotificationRepository.findByReviewSessionId(sessionId).ifPresent(notification -> {
            notification.setRead(true);
            reviewNotificationRepository.save(notification);
        });
    }

    private ZoneId parseZone(String timezone) {
        try {
            return ZoneId.of(timezone);
        } catch (Exception ignored) {
            return ZoneOffset.UTC;
        }
    }

    private void createWeeklyCatchUpSession(
            UserAccount user,
            List<Sentence> sentences,
            Map<Long, Long> reviewCounts,
            Map<Long, Instant> lastReviewedAt,
            Instant now,
            ZoneId zoneId
    ) {
        if (sentences.isEmpty()) {
            return;
        }
        Instant weekStart = weeklyCatchUpStart(now, user.getWeeklyReviewDay(), zoneId);
        if (weekStart.isAfter(now)) {
            return;
        }

        List<Sentence> leastReviewed = sentences.stream()
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
            return;
        }

        ReviewSession session = new ReviewSession();
        session.setUser(user);
        session.setStartAt(weekStart);
        session.setEndAt(weekStart.plus(Duration.ofDays(7)));
        session.setStatus(ReviewSessionStatus.PENDING);
        session.setKind(ReviewSessionKind.WEEKLY_CATCH_UP);
        session = reviewSessionRepository.save(session);

        for (Sentence sentence : leastReviewed) {
            ReviewSessionItem item = new ReviewSessionItem();
            item.setReviewSession(session);
            item.setSentence(sentence);
            item.setDueAt(weekStart);
            reviewSessionItemRepository.save(item);
        }

        ReviewNotification notification = new ReviewNotification();
        notification.setUser(user);
        notification.setReviewSession(session);
        notification.setRead(false);
        reviewNotificationRepository.save(notification);
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
}
