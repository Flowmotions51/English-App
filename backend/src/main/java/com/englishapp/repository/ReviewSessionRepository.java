package com.englishapp.repository;

import com.englishapp.model.ReviewSession;
import com.englishapp.model.ReviewSessionStatus;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface ReviewSessionRepository extends JpaRepository<ReviewSession, Long> {
    List<ReviewSession> findByUserIdAndStatusOrderByStartAtAsc(Long userId, ReviewSessionStatus status);
    Optional<ReviewSession> findByIdAndUserId(Long id, Long userId);
    void deleteByUserIdAndStatus(Long userId, ReviewSessionStatus status);
}
