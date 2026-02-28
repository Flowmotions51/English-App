package com.englishapp.service;

import com.englishapp.model.ScheduleTemplate;
import com.englishapp.model.SentenceScheduleStep;

import java.time.*;
import java.time.temporal.TemporalAdjusters;
import java.util.List;

public final class SchedulePlanner {
    private SchedulePlanner() {
    }

    public static Instant floorByWindow(Instant dueAt, int minutesWindow) {
        long seconds = dueAt.getEpochSecond();
        long bucket = minutesWindow * 60L;
        long floored = (seconds / bucket) * bucket;
        return Instant.ofEpochSecond(floored);
    }

    public static Instant weeklyMergedStart(Instant dueAt, int weeklyReviewDay, ZoneId zoneId) {
        ZonedDateTime dueZoned = dueAt.atZone(zoneId);
        DayOfWeek dayOfWeek = DayOfWeek.of(Math.max(1, Math.min(7, weeklyReviewDay)));
        ZonedDateTime startOfWeek = dueZoned
                .with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))
                .withHour(9)
                .withMinute(0)
                .withSecond(0)
                .withNano(0);
        ZonedDateTime preferred = startOfWeek.with(TemporalAdjusters.nextOrSame(dayOfWeek));
        return preferred.toInstant();
    }

    public static Instant occurrenceAt(ScheduleTemplate scheduleTemplate, Instant createdAt, long occurrenceIndex) {
        List<SentenceScheduleStep> steps = scheduleTemplate.getSteps();
        if (steps.isEmpty()) {
            return null;
        }
        Instant dueAt;
        if (occurrenceIndex < steps.size()) {
            dueAt = createdAt.plus(Duration.ofMinutes(steps.get((int) occurrenceIndex).getOffsetMinutes()));
        } else if (scheduleTemplate.isOpenEnded()) {
            int lastOffset = steps.get(steps.size() - 1).getOffsetMinutes();
            long weeklyStep = occurrenceIndex - steps.size() + 1;
            dueAt = createdAt.plus(Duration.ofMinutes(lastOffset)).plus(Duration.ofDays(7L * weeklyStep));
        } else {
            return null;
        }
        if (scheduleTemplate.getEndDate() != null) {
            LocalDate dueDate = LocalDateTime.ofInstant(dueAt, ZoneOffset.UTC).toLocalDate();
            if (dueDate.isAfter(scheduleTemplate.getEndDate())) {
                return null;
            }
        }
        return dueAt;
    }
}
