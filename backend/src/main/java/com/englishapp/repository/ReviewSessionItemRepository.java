package com.englishapp.repository;

import com.englishapp.model.ReviewSessionItem;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

public interface ReviewSessionItemRepository extends JpaRepository<ReviewSessionItem, Long> {
    @Query("""
            select i from ReviewSessionItem i
            join fetch i.sentence s
            left join fetch s.meaningGroup
            join fetch s.sentenceList
            where i.reviewSession.id = :sessionId
            order by i.id asc
            """)
    List<ReviewSessionItem> findByReviewSessionId(@Param("sessionId") Long sessionId);

    @Query("""
            select i from ReviewSessionItem i
            join fetch i.sentence s
            left join fetch s.meaningGroup
            join fetch s.sentenceList
            where i.reviewSession.id in :sessionIds
            order by i.reviewSession.id asc, i.id asc
            """)
    List<ReviewSessionItem> findByReviewSessionIdIn(@Param("sessionIds") List<Long> sessionIds);
}
