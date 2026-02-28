package com.englishapp.repository;

import com.englishapp.model.ReviewSessionItem;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface ReviewSessionItemRepository extends JpaRepository<ReviewSessionItem, Long> {
    List<ReviewSessionItem> findByReviewSessionId(Long reviewSessionId);
}
