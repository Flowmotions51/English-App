package com.englishapp.repository;

import com.englishapp.model.ReviewNotification;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface ReviewNotificationRepository extends JpaRepository<ReviewNotification, Long> {
    List<ReviewNotification> findByUserIdOrderByCreatedAtDesc(Long userId);
    Optional<ReviewNotification> findByReviewSessionId(Long reviewSessionId);
    void deleteByUserId(Long userId);
}
