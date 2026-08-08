package com.englishapp.service;

import com.englishapp.model.ReviewNotification;
import com.englishapp.model.ReviewSession;
import com.englishapp.model.ReviewSessionItem;
import com.englishapp.model.ReviewSessionKind;
import com.englishapp.model.ReviewSessionStatus;
import com.englishapp.model.ScheduleTemplate;
import com.englishapp.model.Sentence;
import com.englishapp.model.SentenceReview;
import com.englishapp.model.SentenceScheduleStep;
import com.englishapp.model.UserAccount;
import com.englishapp.repository.ReviewNotificationRepository;
import com.englishapp.repository.ReviewSessionItemRepository;
import com.englishapp.repository.ReviewSessionRepository;
import com.englishapp.repository.ScheduleTemplateRepository;
import com.englishapp.repository.SentenceRepository;
import com.englishapp.repository.SentenceReviewRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicLong;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class ReviewServiceTest {

    @Mock
    private SentenceRepository sentenceRepository;
    @Mock
    private ScheduleTemplateRepository scheduleTemplateRepository;
    @Mock
    private SentenceReviewRepository sentenceReviewRepository;
    @Mock
    private ReviewSessionRepository reviewSessionRepository;
    @Mock
    private ReviewSessionItemRepository reviewSessionItemRepository;
    @Mock
    private ReviewNotificationRepository reviewNotificationRepository;

    private ReviewService reviewService;
    private final AtomicLong sessionIds = new AtomicLong(1);

    @BeforeEach
    void setUp() {
        reviewService = new ReviewService(
                sentenceRepository,
                scheduleTemplateRepository,
                sentenceReviewRepository,
                reviewSessionRepository,
                reviewSessionItemRepository,
                reviewNotificationRepository
        );

        lenient().when(scheduleTemplateRepository.findBySentenceSentenceListUserId(anyLong())).thenReturn(List.of());
        lenient().when(sentenceReviewRepository.countReviewsBySentenceForUserAsMap(anyLong())).thenReturn(Map.of());
        lenient().when(sentenceReviewRepository.lastReviewedAtBySentenceForUserAsMap(anyLong())).thenReturn(Map.of());
        lenient().when(reviewSessionRepository.save(any(ReviewSession.class))).thenAnswer(invocation -> {
            ReviewSession session = invocation.getArgument(0);
            if (session.getId() == null) {
                session.setId(sessionIds.getAndIncrement());
            }
            return session;
        });
        lenient().when(reviewSessionItemRepository.save(any(ReviewSessionItem.class))).thenAnswer(invocation -> invocation.getArgument(0));
        lenient().when(reviewNotificationRepository.save(any(ReviewNotification.class))).thenAnswer(invocation -> invocation.getArgument(0));
        lenient().when(reviewNotificationRepository.findByReviewSessionId(anyLong())).thenReturn(Optional.empty());
    }

    @Test
    void refreshingTwiceWithUnchangedDueSetKeepsTheSameSessionId() {
        UserAccount user = user();
        Sentence sentence = sentence(1L, Instant.parse("2026-07-01T00:00:00Z"));
        when(sentenceRepository.findAllByUserId(user.getId())).thenReturn(List.of(sentence));
        when(reviewSessionRepository.findByUserIdAndStatusOrderByStartAtAscIdAsc(user.getId(), ReviewSessionStatus.PENDING))
                .thenReturn(List.of());

        reviewService.refreshPendingSessions(user);

        ReviewSession created = captureCreatedSession();
        clearInvocations(reviewSessionRepository, reviewSessionItemRepository, reviewNotificationRepository);

        // Second refresh (a second login, a page reload, another tab) sees the session
        // that already exists in the DB, unchanged.
        when(reviewSessionRepository.findByUserIdAndStatusOrderByStartAtAscIdAsc(user.getId(), ReviewSessionStatus.PENDING))
                .thenReturn(List.of(created));
        when(reviewSessionItemRepository.findByReviewSessionIdIn(List.of(created.getId())))
                .thenReturn(List.of(itemFor(created, sentence)));

        reviewService.refreshPendingSessions(user);

        // No new session/item/notification created, and nothing deleted: an id a client
        // already has open (e.g. in another tab) must stay valid.
        verify(reviewSessionRepository, never()).save(any(ReviewSession.class));
        verify(reviewSessionItemRepository, never()).save(any(ReviewSessionItem.class));
        verify(reviewNotificationRepository, never()).save(any(ReviewNotification.class));
        verify(reviewSessionRepository, never()).deleteAll(any());
    }

    @Test
    void refreshingRemovesOnlyStaleSessionsWhenDueSetChanges() {
        UserAccount user = user();
        Sentence stale = sentence(1L, Instant.parse("2026-07-01T00:00:00Z"));
        ReviewSession staleSession = new ReviewSession();
        staleSession.setId(999L);
        staleSession.setKind(ReviewSessionKind.INITIAL);

        // The sentence backing the old session was deleted/reviewed elsewhere; it's no
        // longer part of the current sentence list at all.
        when(sentenceRepository.findAllByUserId(user.getId())).thenReturn(List.of());
        when(reviewSessionRepository.findByUserIdAndStatusOrderByStartAtAscIdAsc(user.getId(), ReviewSessionStatus.PENDING))
                .thenReturn(List.of(staleSession));
        when(reviewSessionItemRepository.findByReviewSessionIdIn(List.of(staleSession.getId())))
                .thenReturn(List.of(itemFor(staleSession, stale)));

        reviewService.refreshPendingSessions(user);

        verify(reviewSessionRepository).deleteAll(List.of(staleSession));
    }

    @Test
    void completingASubsetKeepsTheSessionPendingWithOnlyTheRemainingItems() {
        UserAccount user = user();
        ReviewSession session = new ReviewSession();
        session.setId(42L);
        session.setStatus(ReviewSessionStatus.PENDING);
        Sentence reviewed = sentence(1L, Instant.parse("2026-07-01T00:00:00Z"));
        Sentence untouched = sentence(2L, Instant.parse("2026-07-01T00:00:00Z"));
        ReviewSessionItem reviewedItem = itemFor(session, reviewed);
        ReviewSessionItem untouchedItem = itemFor(session, untouched);

        when(reviewSessionRepository.findByIdAndUserId(session.getId(), user.getId())).thenReturn(Optional.of(session));
        when(reviewSessionItemRepository.findByReviewSessionId(session.getId()))
                .thenReturn(List.of(reviewedItem, untouchedItem));

        int remaining = reviewService.completeSession(user, session.getId(), List.of(reviewed.getId()));

        assertEquals(1, remaining);
        verify(sentenceReviewRepository, times(1)).save(any(SentenceReview.class));
        verify(reviewSessionItemRepository).delete(reviewedItem);
        verify(reviewSessionItemRepository, never()).delete(untouchedItem);
        verify(reviewSessionRepository, never()).save(any(ReviewSession.class));
        assertEquals(ReviewSessionStatus.PENDING, session.getStatus());
    }

    @Test
    void completingEveryItemMarksTheSessionCompleted() {
        UserAccount user = user();
        ReviewSession session = new ReviewSession();
        session.setId(43L);
        session.setStatus(ReviewSessionStatus.PENDING);
        Sentence sentence = sentence(1L, Instant.parse("2026-07-01T00:00:00Z"));
        ReviewSessionItem item = itemFor(session, sentence);

        when(reviewSessionRepository.findByIdAndUserId(session.getId(), user.getId())).thenReturn(Optional.of(session));
        when(reviewSessionItemRepository.findByReviewSessionId(session.getId())).thenReturn(List.of(item));

        int remaining = reviewService.completeSession(user, session.getId(), null);

        assertEquals(0, remaining);
        verify(reviewSessionItemRepository).delete(item);
        assertEquals(ReviewSessionStatus.COMPLETED, session.getStatus());
    }

    @Test
    void sentenceWithRecentScheduleResetIsNotDueDespiteOldReviewHistory() {
        UserAccount user = user();
        // Long-ago createdAt + a large historical review count would normally make this
        // due immediately; but the sentence was excluded and then re-included (resetting
        // its schedule position) two hours ago, with no reviews recorded since — the first
        // step (1 day) hasn't elapsed from the reset anchor yet.
        Sentence sentence = sentence(1L, Instant.parse("2020-01-01T00:00:00Z"));
        Instant resetAt = Instant.now().minus(java.time.Duration.ofHours(2));
        sentence.setScheduleResetAt(resetAt);
        ScheduleTemplate schedule = scheduleTemplate(sentence, List.of(1440, 2880), false);

        when(sentenceRepository.findAllByUserId(user.getId())).thenReturn(List.of(sentence));
        when(scheduleTemplateRepository.findBySentenceSentenceListUserId(user.getId())).thenReturn(List.of(schedule));
        when(sentenceReviewRepository.countReviewsBySentenceForUserAsMap(user.getId()))
                .thenReturn(Map.of(sentence.getId(), 5L));
        when(sentenceReviewRepository.countBySentence_IdAndUser_IdAndReviewedAtGreaterThanEqual(sentence.getId(), user.getId(), resetAt))
                .thenReturn(0L);
        when(reviewSessionRepository.findByUserIdAndStatusOrderByStartAtAscIdAsc(user.getId(), ReviewSessionStatus.PENDING))
                .thenReturn(List.of());

        reviewService.refreshPendingSessions(user);

        // The user's weekly-catch-up bucket independently sweeps in any previously-reviewed
        // sentence regardless of its per-step due status, so a session may still be saved for
        // that; what we're asserting is that no REGULAR (due-date-driven) session is created.
        ArgumentCaptor<ReviewSession> captor = ArgumentCaptor.forClass(ReviewSession.class);
        verify(reviewSessionRepository, org.mockito.Mockito.atLeast(0)).save(captor.capture());
        assertEquals(0, captor.getAllValues().stream().filter(s -> s.getKind() == ReviewSessionKind.REGULAR).count());
    }

    @Test
    void sentenceWithScheduleResetUsesResetAnchorForDueComputation() {
        UserAccount user = user();
        Sentence sentence = sentence(1L, Instant.parse("2020-01-01T00:00:00Z"));
        // Reset 10 days ago with no reviews since: occurrenceIndex 0 is due at
        // resetAt + first step (1 day), which is well before "now" — despite the old
        // createdAt/history, the sentence becomes due relative to the reset anchor.
        Instant resetAt = Instant.now().minus(java.time.Duration.ofDays(10));
        sentence.setScheduleResetAt(resetAt);
        ScheduleTemplate schedule = scheduleTemplate(sentence, List.of(1440, 2880), false);

        when(sentenceRepository.findAllByUserId(user.getId())).thenReturn(List.of(sentence));
        when(scheduleTemplateRepository.findBySentenceSentenceListUserId(user.getId())).thenReturn(List.of(schedule));
        when(sentenceReviewRepository.countReviewsBySentenceForUserAsMap(user.getId()))
                .thenReturn(Map.of(sentence.getId(), 5L));
        when(sentenceReviewRepository.countBySentence_IdAndUser_IdAndReviewedAtGreaterThanEqual(sentence.getId(), user.getId(), resetAt))
                .thenReturn(0L);
        when(reviewSessionRepository.findByUserIdAndStatusOrderByStartAtAscIdAsc(user.getId(), ReviewSessionStatus.PENDING))
                .thenReturn(List.of());

        reviewService.refreshPendingSessions(user);

        ArgumentCaptor<ReviewSession> captor = ArgumentCaptor.forClass(ReviewSession.class);
        verify(reviewSessionRepository, org.mockito.Mockito.atLeastOnce()).save(captor.capture());
        assertEquals(1, captor.getAllValues().stream().filter(s -> s.getKind() == ReviewSessionKind.REGULAR).count());
    }

    @Test
    void reviewAutoExcludesSentenceOnceThresholdIsReached() {
        UserAccount user = user();
        user.setAutoExcludeAfterReviews(1);
        Sentence sentence = sentence(1L, Instant.parse("2026-07-01T00:00:00Z"));

        when(sentenceRepository.findByIdAndUser(sentence.getId(), user.getId())).thenReturn(Optional.of(sentence));
        // Called once before saving the review (0, still eligible for the INITIAL path) and once
        // after (1, at the configured threshold) inside the auto-exclude check.
        when(sentenceReviewRepository.countBySentence_IdAndUser_Id(sentence.getId(), user.getId())).thenReturn(0L, 1L);
        when(sentenceRepository.findAllByUserId(user.getId())).thenReturn(List.of(sentence));
        when(reviewSessionRepository.findByUserIdAndStatusOrderByStartAtAscIdAsc(user.getId(), ReviewSessionStatus.PENDING))
                .thenReturn(List.of());

        Map<String, Object> result = reviewService.completeSentenceFromListReview(user, sentence.getId());

        assertEquals(true, result.get("recorded"));
        assertTrue(sentence.isExcludedFromSchedule());
    }

    @Test
    void autoExcludeIsDisabledWhenThresholdIsZero() {
        UserAccount user = user();
        user.setAutoExcludeAfterReviews(0);
        Sentence sentence = sentence(1L, Instant.parse("2026-07-01T00:00:00Z"));

        when(sentenceRepository.findByIdAndUser(sentence.getId(), user.getId())).thenReturn(Optional.of(sentence));
        when(sentenceReviewRepository.countBySentence_IdAndUser_Id(sentence.getId(), user.getId())).thenReturn(0L, 1L);
        when(sentenceRepository.findAllByUserId(user.getId())).thenReturn(List.of(sentence));
        when(reviewSessionRepository.findByUserIdAndStatusOrderByStartAtAscIdAsc(user.getId(), ReviewSessionStatus.PENDING))
                .thenReturn(List.of());

        reviewService.completeSentenceFromListReview(user, sentence.getId());

        assertFalse(sentence.isExcludedFromSchedule());
    }

    private ScheduleTemplate scheduleTemplate(Sentence sentence, List<Integer> offsetsMinutes, boolean openEnded) {
        ScheduleTemplate template = new ScheduleTemplate();
        template.setSentence(sentence);
        template.setOpenEnded(openEnded);
        List<SentenceScheduleStep> steps = new java.util.ArrayList<>();
        for (int i = 0; i < offsetsMinutes.size(); i++) {
            SentenceScheduleStep step = new SentenceScheduleStep();
            step.setStepOrder(i);
            step.setOffsetMinutes(offsetsMinutes.get(i));
            steps.add(step);
        }
        template.setSteps(steps);
        return template;
    }

    private ReviewSession captureCreatedSession() {
        ArgumentCaptor<ReviewSession> captor = ArgumentCaptor.forClass(ReviewSession.class);
        verify(reviewSessionRepository).save(captor.capture());
        return captor.getValue();
    }

    private ReviewSessionItem itemFor(ReviewSession session, Sentence sentence) {
        ReviewSessionItem item = new ReviewSessionItem();
        item.setReviewSession(session);
        item.setSentence(sentence);
        item.setDueAt(sentence.getCreatedAt());
        return item;
    }

    private UserAccount user() {
        UserAccount user = new UserAccount();
        user.setId(1L);
        user.setTimezone("UTC");
        user.setMergeWindowMinutes(60);
        user.setWeeklyReviewDay(1);
        return user;
    }

    private Sentence sentence(Long id, Instant createdAt) {
        Sentence sentence = new Sentence();
        sentence.setId(id);
        sentence.setCreatedAt(createdAt);
        return sentence;
    }
}
