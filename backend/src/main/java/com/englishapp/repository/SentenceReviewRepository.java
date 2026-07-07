package com.englishapp.repository;

import com.englishapp.model.SentenceReview;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

public interface SentenceReviewRepository extends JpaRepository<SentenceReview, Long> {
    long countBySentenceId(Long sentenceId);

    long countBySentence_IdAndUser_Id(Long sentenceId, Long userId);

    long countByUser_IdAndReviewedAtGreaterThanEqualAndReviewedAtLessThan(Long userId, Instant start, Instant end);

    long countBySentence_IdAndUser_IdAndReviewedAtGreaterThanEqual(Long sentenceId, Long userId, Instant start);

    @Query("select sr.reviewedAt from SentenceReview sr where sr.user.id = :userId order by sr.reviewedAt")
    List<Instant> reviewInstantsForUser(@Param("userId") Long userId);

    @Query("select sr.reviewedAt from SentenceReview sr where sr.user.id = :userId and sr.reviewedAt >= :start order by sr.reviewedAt")
    List<Instant> reviewInstantsForUserSince(@Param("userId") Long userId, @Param("start") Instant start);

    @Query("select sr.reviewedAt from SentenceReview sr where sr.sentence.id = :sentenceId and sr.user.id = :userId and sr.reviewedAt >= :start order by sr.reviewedAt")
    List<Instant> reviewInstantsForSentenceSince(@Param("sentenceId") Long sentenceId, @Param("userId") Long userId, @Param("start") Instant start);

    @Query("select max(sr.reviewedAt) from SentenceReview sr where sr.sentence.id = :sentenceId and sr.user.id = :userId")
    Instant lastReviewedAtForSentence(@Param("sentenceId") Long sentenceId, @Param("userId") Long userId);

    @Query("select sr.sentence.id, count(sr.id) from SentenceReview sr where sr.user.id = :userId group by sr.sentence.id")
    java.util.List<Object[]> countReviewsBySentenceForUser(@Param("userId") Long userId);

    default Map<Long, Long> countReviewsBySentenceForUserAsMap(Long userId) {
        return countReviewsBySentenceForUser(userId).stream()
                .collect(Collectors.toMap(
                        row -> ((Number) row[0]).longValue(),
                        row -> ((Number) row[1]).longValue()
                ));
    }

    @Query("select sr.sentence.id, max(sr.reviewedAt) from SentenceReview sr where sr.user.id = :userId group by sr.sentence.id")
    java.util.List<Object[]> lastReviewedAtBySentenceForUser(@Param("userId") Long userId);

    default Map<Long, Instant> lastReviewedAtBySentenceForUserAsMap(Long userId) {
        return lastReviewedAtBySentenceForUser(userId).stream()
                .collect(Collectors.toMap(
                        row -> ((Number) row[0]).longValue(),
                        row -> (Instant) row[1]
                ));
    }
}
