package com.englishapp.service;

import com.englishapp.model.ReviewNotification;
import com.englishapp.model.ReviewSession;
import com.englishapp.model.ReviewSessionItem;
import com.englishapp.model.ReviewSessionKind;
import com.englishapp.model.ReviewSessionStatus;
import com.englishapp.model.Sentence;
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

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
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

        when(scheduleTemplateRepository.findBySentenceSentenceListUserId(anyLong())).thenReturn(List.of());
        when(sentenceReviewRepository.countReviewsBySentenceForUserAsMap(anyLong())).thenReturn(Map.of());
        when(sentenceReviewRepository.lastReviewedAtBySentenceForUserAsMap(anyLong())).thenReturn(Map.of());
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
        when(reviewSessionItemRepository.findByReviewSessionId(created.getId()))
                .thenReturn(List.of(itemFor(created, sentence)));

        reviewService.refreshPendingSessions(user);

        // No new session/item/notification created, and nothing deleted: an id a client
        // already has open (e.g. in another tab) must stay valid.
        verify(reviewSessionRepository, never()).save(any(ReviewSession.class));
        verify(reviewSessionItemRepository, never()).save(any(ReviewSessionItem.class));
        verify(reviewNotificationRepository, never()).save(any(ReviewNotification.class));
        verify(reviewSessionRepository, never()).delete(any(ReviewSession.class));
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
        when(reviewSessionItemRepository.findByReviewSessionId(staleSession.getId()))
                .thenReturn(List.of(itemFor(staleSession, stale)));

        reviewService.refreshPendingSessions(user);

        verify(reviewSessionRepository).delete(staleSession);
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
