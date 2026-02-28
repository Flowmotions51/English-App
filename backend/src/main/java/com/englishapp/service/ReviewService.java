package com.englishapp.service;

import com.englishapp.model.*;
import com.englishapp.repository.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.*;
import java.util.*;

@Service
public class ReviewService {
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
        List<DueSentence> dueSentences = new ArrayList<>();
        Instant now = Instant.now();
        ZoneId zoneId = parseZone(user.getTimezone());

        for (Sentence sentence : sentences) {
            ScheduleTemplate schedule = scheduleBySentence.get(sentence.getId());
            if (schedule == null || schedule.getSteps().isEmpty()) {
                continue;
            }
            long reviewed = reviewCounts.getOrDefault(sentence.getId(), 0L);
            Instant dueAt = SchedulePlanner.occurrenceAt(schedule, sentence.getCreatedAt(), reviewed);
            if (dueAt == null || dueAt.isAfter(now)) {
                continue;
            }
            boolean weeklyCadence = reviewed >= schedule.getSteps().size() && schedule.isOpenEnded();
            dueSentences.add(new DueSentence(sentence, dueAt, weeklyCadence));
        }

        if (dueSentences.isEmpty()) {
            return;
        }

        Map<Instant, List<DueSentence>> grouped = new TreeMap<>();
        int mergeWindow = user.getMergeWindowMinutes();
        for (DueSentence dueSentence : dueSentences) {
            Instant start = dueSentence.weeklyCadence()
                    ? SchedulePlanner.weeklyMergedStart(dueSentence.dueAt(), user.getWeeklyReviewDay(), zoneId)
                    : SchedulePlanner.floorByWindow(dueSentence.dueAt(), mergeWindow);
            grouped.computeIfAbsent(start, ignored -> new ArrayList<>()).add(dueSentence);
        }

        for (Map.Entry<Instant, List<DueSentence>> entry : grouped.entrySet()) {
            ReviewSession session = new ReviewSession();
            session.setUser(user);
            session.setStartAt(entry.getKey());
            session.setEndAt(entry.getKey().plus(Duration.ofMinutes(mergeWindow)));
            session.setStatus(ReviewSessionStatus.PENDING);
            session = reviewSessionRepository.save(session);

            for (DueSentence dueSentence : entry.getValue()) {
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

    @Transactional(readOnly = true)
    public List<Map<String, Object>> pendingSessions(UserAccount user) {
        List<ReviewSession> sessions = reviewSessionRepository
                .findByUserIdAndStatusOrderByStartAtAsc(user.getId(), ReviewSessionStatus.PENDING);
        Instant now = Instant.now();
        return sessions.stream().map(session -> {
            List<Map<String, Object>> items = reviewSessionItemRepository.findByReviewSessionId(session.getId()).stream()
                    .map(item -> Map.<String, Object>of(
                            "sentenceId", item.getSentence().getId(),
                            "listId", item.getSentence().getSentenceList().getId(),
                            "content", item.getSentence().getContent(),
                            "dueAt", item.getDueAt()
                    ))
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

    private record DueSentence(Sentence sentence, Instant dueAt, boolean weeklyCadence) {
    }
}
