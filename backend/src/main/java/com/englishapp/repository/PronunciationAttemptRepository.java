package com.englishapp.repository;

import com.englishapp.model.PronunciationAttempt;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;

public interface PronunciationAttemptRepository extends JpaRepository<PronunciationAttempt, Long> {
    long countByUser_Id(Long userId);

    long countByUser_IdAndSuccessfulTrue(Long userId);

    long countBySentence_IdAndUser_Id(Long sentenceId, Long userId);

    long countBySentence_IdAndUser_IdAndSuccessfulTrue(Long sentenceId, Long userId);

    @Query("select avg(a.attemptNumber) from PronunciationAttempt a where a.user.id = :userId and a.successful = true")
    Double averageSuccessfulAttemptNumberForUser(@Param("userId") Long userId);

    @Query("select avg(a.attemptNumber) from PronunciationAttempt a where a.sentence.id = :sentenceId and a.user.id = :userId and a.successful = true")
    Double averageSuccessfulAttemptNumberForSentence(@Param("sentenceId") Long sentenceId, @Param("userId") Long userId);

    @Query("""
            select a.attemptNumber, count(a.id)
            from PronunciationAttempt a
            where a.user.id = :userId and a.successful = true
            group by a.attemptNumber
            order by a.attemptNumber
            """)
    List<Object[]> successfulAttemptDistributionForUser(@Param("userId") Long userId);

    @Query("""
            select a.attemptNumber, count(a.id)
            from PronunciationAttempt a
            where a.sentence.id = :sentenceId and a.user.id = :userId and a.successful = true
            group by a.attemptNumber
            order by a.attemptNumber
            """)
    List<Object[]> successfulAttemptDistributionForSentence(@Param("sentenceId") Long sentenceId, @Param("userId") Long userId);

    @Query("select a.createdAt, a.successful from PronunciationAttempt a where a.user.id = :userId and a.createdAt >= :start order by a.createdAt")
    List<Object[]> attemptsSinceForUser(@Param("userId") Long userId, @Param("start") Instant start);

    @Query("select a.createdAt, a.successful from PronunciationAttempt a where a.sentence.id = :sentenceId and a.user.id = :userId and a.createdAt >= :start order by a.createdAt")
    List<Object[]> attemptsSinceForSentence(@Param("sentenceId") Long sentenceId, @Param("userId") Long userId, @Param("start") Instant start);
}
