package com.englishapp.repository;

import com.englishapp.model.SentenceList;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface SentenceListRepository extends JpaRepository<SentenceList, Long> {
    List<SentenceList> findByUserIdOrderByCreatedAtDesc(Long userId);
    Optional<SentenceList> findByIdAndUserId(Long id, Long userId);
}
