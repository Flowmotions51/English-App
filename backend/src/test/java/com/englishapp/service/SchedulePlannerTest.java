package com.englishapp.service;

import com.englishapp.model.ScheduleTemplate;
import com.englishapp.model.SentenceScheduleStep;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class SchedulePlannerTest {

    @Test
    void floorByWindowShouldRoundDown() {
        Instant instant = Instant.parse("2026-02-24T12:37:22Z");
        Instant rounded = SchedulePlanner.floorByWindow(instant, 60);
        assertEquals(Instant.parse("2026-02-24T12:00:00Z"), rounded);
    }

    @Test
    void weeklyMergedStartUsesPreferredDayInWeek() {
        Instant dueAt = Instant.parse("2026-02-25T18:00:00Z");
        Instant merged = SchedulePlanner.weeklyMergedStart(dueAt, 5, ZoneId.of("UTC"));
        assertEquals(Instant.parse("2026-02-27T09:00:00Z"), merged);
    }

    @Test
    void openEndedOccurrenceShouldRepeatWeeklyAfterBasePattern() {
        ScheduleTemplate template = template(List.of(60, 180, 360), true, null);
        Instant createdAt = Instant.parse("2026-02-24T00:00:00Z");

        Instant dueAt = SchedulePlanner.occurrenceAt(template, createdAt, 3);

        assertEquals(Instant.parse("2026-03-03T06:00:00Z"), dueAt);
    }

    @Test
    void endDateShouldStopSchedule() {
        ScheduleTemplate template = template(List.of(60, 180), true, LocalDate.parse("2026-02-24"));
        Instant createdAt = Instant.parse("2026-02-24T00:00:00Z");

        Instant dueAt = SchedulePlanner.occurrenceAt(template, createdAt, 2);

        assertNull(dueAt);
    }

    private ScheduleTemplate template(List<Integer> steps, boolean openEnded, LocalDate endDate) {
        ScheduleTemplate scheduleTemplate = new ScheduleTemplate();
        scheduleTemplate.setOpenEnded(openEnded);
        scheduleTemplate.setEndDate(endDate);
        scheduleTemplate.setSteps(new ArrayList<>());
        for (int i = 0; i < steps.size(); i++) {
            SentenceScheduleStep step = new SentenceScheduleStep();
            step.setStepOrder(i);
            step.setOffsetMinutes(steps.get(i));
            step.setScheduleTemplate(scheduleTemplate);
            scheduleTemplate.getSteps().add(step);
        }
        return scheduleTemplate;
    }
}
