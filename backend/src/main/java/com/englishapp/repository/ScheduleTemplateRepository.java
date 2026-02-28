package com.englishapp.repository;

import com.englishapp.model.ScheduleTemplate;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface ScheduleTemplateRepository extends JpaRepository<ScheduleTemplate, Long> {
    Optional<ScheduleTemplate> findBySentenceId(Long sentenceId);
    List<ScheduleTemplate> findBySentenceSentenceListUserId(Long userId);
}
