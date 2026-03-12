package com.englishapp.repository;

import com.englishapp.model.SentenceReview;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Map;
import java.util.stream.Collectors;

public interface SentenceReviewRepository extends JpaRepository<SentenceReview, Long> {
    long countBySentenceId(Long sentenceId);

    long countBySentence_IdAndUser_Id(Long sentenceId, Long userId);

    @Query("select sr.sentence.id, count(sr.id) from SentenceReview sr where sr.user.id = :userId group by sr.sentence.id")
    java.util.List<Object[]> countReviewsBySentenceForUser(@Param("userId") Long userId);

    default Map<Long, Long> countReviewsBySentenceForUserAsMap(Long userId) {
        return countReviewsBySentenceForUser(userId).stream()
                .collect(Collectors.toMap(
                        row -> ((Number) row[0]).longValue(),
                        row -> ((Number) row[1]).longValue()
                ));
    }
}
