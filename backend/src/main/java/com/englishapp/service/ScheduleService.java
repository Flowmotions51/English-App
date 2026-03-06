package com.englishapp.service;

import com.englishapp.model.ScheduleTemplate;
import com.englishapp.model.Sentence;
import com.englishapp.model.SentenceScheduleStep;
import com.englishapp.repository.ScheduleTemplateRepository;
import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Service
public class ScheduleService {
    public static final List<Integer> DEFAULT_STEPS_MINUTES = List.of(60, 180, 360, 1440, 2880, 10080);

    private final ScheduleTemplateRepository scheduleTemplateRepository;
    private final EntityManager entityManager;

    public ScheduleService(ScheduleTemplateRepository scheduleTemplateRepository, EntityManager entityManager) {
        this.scheduleTemplateRepository = scheduleTemplateRepository;
        this.entityManager = entityManager;
    }

    @Transactional
    public ScheduleTemplate createDefaultSchedule(Sentence sentence) {
        ScheduleTemplate template = new ScheduleTemplate();
        template.setSentence(sentence);
        template.setOpenEnded(true);
        template.setUpdatedAt(Instant.now());
        template.setSteps(new ArrayList<>());

        for (int i = 0; i < DEFAULT_STEPS_MINUTES.size(); i++) {
            SentenceScheduleStep step = new SentenceScheduleStep();
            step.setScheduleTemplate(template);
            step.setStepOrder(i);
            step.setOffsetMinutes(DEFAULT_STEPS_MINUTES.get(i));
            template.getSteps().add(step);
        }
        return scheduleTemplateRepository.save(template);
    }

    public ScheduleTemplate getScheduleForSentence(Long sentenceId) {
        return scheduleTemplateRepository.findBySentenceId(sentenceId)
                .orElseThrow(() -> new NotFoundException("Schedule not found"));
    }

    @Transactional(readOnly = true)
    public Map<String, Object> getSchedulePayload(Long sentenceId) {
        ScheduleTemplate template = getScheduleForSentence(sentenceId);
        return toPayload(template);
    }

    @Transactional
    public Map<String, Object> updateSchedule(Sentence sentence, List<Integer> intervals, boolean openEnded, LocalDate endDate) {
        if (intervals == null || intervals.isEmpty()) {
            throw new IllegalArgumentException("Intervals cannot be empty");
        }
        ScheduleTemplate template = scheduleTemplateRepository.findBySentenceId(sentence.getId())
                .orElseGet(() -> {
                    ScheduleTemplate fresh = new ScheduleTemplate();
                    fresh.setSentence(sentence);
                    fresh.setSteps(new ArrayList<>());
                    return fresh;
                });

        template.getSteps().clear();
        entityManager.flush(); // Run orphan-removal DELETEs before inserting new steps (avoids unique constraint)
        for (int i = 0; i < intervals.size(); i++) {
            Integer interval = intervals.get(i);
            if (interval == null || interval <= 0) {
                throw new IllegalArgumentException("Each interval must be positive minutes");
            }
            SentenceScheduleStep step = new SentenceScheduleStep();
            step.setScheduleTemplate(template);
            step.setStepOrder(i);
            step.setOffsetMinutes(interval);
            template.getSteps().add(step);
        }
        template.setOpenEnded(openEnded);
        template.setEndDate(endDate);
        template.setUpdatedAt(Instant.now());
        template = scheduleTemplateRepository.save(template);
        return toPayload(template);
    }

    public Map<String, Object> toPayload(ScheduleTemplate scheduleTemplate) {
        Map<String, Object> payload = new HashMap<>();
        payload.put("sentenceId", scheduleTemplate.getSentence().getId());
        payload.put("openEnded", scheduleTemplate.isOpenEnded());
        payload.put("endDate", scheduleTemplate.getEndDate());
        payload.put("intervalMinutes", scheduleTemplate.getSteps().stream()
                .map(SentenceScheduleStep::getOffsetMinutes)
                .toList());
        return payload;
    }
}
