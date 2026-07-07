package com.englishapp.service;

import com.englishapp.model.PronunciationAttempt;
import com.englishapp.model.ReviewSession;
import com.englishapp.model.Sentence;
import com.englishapp.model.UserAccount;
import com.englishapp.repository.PronunciationAttemptRepository;
import com.englishapp.repository.ReviewSessionRepository;
import com.englishapp.repository.SentenceRepository;
import com.englishapp.repository.SentenceReviewRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.*;
import java.time.temporal.TemporalAdjusters;
import java.util.*;

@Service
public class StatsService {
    private static final int CHART_DAYS = 30;

    private final SentenceRepository sentenceRepository;
    private final SentenceReviewRepository sentenceReviewRepository;
    private final PronunciationAttemptRepository pronunciationAttemptRepository;
    private final ReviewSessionRepository reviewSessionRepository;

    public StatsService(
            SentenceRepository sentenceRepository,
            SentenceReviewRepository sentenceReviewRepository,
            PronunciationAttemptRepository pronunciationAttemptRepository,
            ReviewSessionRepository reviewSessionRepository
    ) {
        this.sentenceRepository = sentenceRepository;
        this.sentenceReviewRepository = sentenceReviewRepository;
        this.pronunciationAttemptRepository = pronunciationAttemptRepository;
        this.reviewSessionRepository = reviewSessionRepository;
    }

    @Transactional
    public Map<String, Object> recordPronunciationAttempt(UserAccount user, PronunciationAttemptRequest request) {
        Sentence sentence = sentenceRepository.findByIdAndUser(request.sentenceId(), user.getId())
                .orElseThrow(() -> new NotFoundException("Sentence not found"));

        ReviewSession session = null;
        if (request.reviewSessionId() != null) {
            session = reviewSessionRepository.findByIdAndUserId(request.reviewSessionId(), user.getId())
                    .orElseThrow(() -> new NotFoundException("Review session not found"));
        }

        PronunciationAttempt attempt = new PronunciationAttempt();
        attempt.setUser(user);
        attempt.setSentence(sentence);
        attempt.setReviewSession(session);
        attempt.setSuccessful(Boolean.TRUE.equals(request.successful()));
        attempt.setAttemptNumber(clamp(request.attemptNumber(), 1, 50));
        attempt.setStage(request.stage() == null ? null : clamp(request.stage(), 1, 3));
        attempt.setPartIndex(request.partIndex() == null ? null : Math.max(0, request.partIndex()));
        attempt.setPartCount(request.partCount() == null ? null : Math.max(1, request.partCount()));
        attempt.setSource(safeSource(request.source()));
        attempt.setCreatedAt(Instant.now());
        attempt = pronunciationAttemptRepository.save(attempt);

        return Map.of("id", attempt.getId(), "status", "ok");
    }

    @Transactional(readOnly = true)
    public Map<String, Object> overview(UserAccount user) {
        ZoneId zoneId = parseZone(user.getTimezone());
        LocalDate today = LocalDate.now(zoneId);
        Instant dayStart = today.atStartOfDay(zoneId).toInstant();
        Instant tomorrowStart = today.plusDays(1).atStartOfDay(zoneId).toInstant();
        Instant weekStart = today.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY)).atStartOfDay(zoneId).toInstant();
        Instant monthStart = today.withDayOfMonth(1).atStartOfDay(zoneId).toInstant();

        long reviewedToday = sentenceReviewRepository.countByUser_IdAndReviewedAtGreaterThanEqualAndReviewedAtLessThan(user.getId(), dayStart, tomorrowStart);
        long reviewedThisWeek = sentenceReviewRepository.countByUser_IdAndReviewedAtGreaterThanEqualAndReviewedAtLessThan(user.getId(), weekStart, tomorrowStart);
        long reviewedThisMonth = sentenceReviewRepository.countByUser_IdAndReviewedAtGreaterThanEqualAndReviewedAtLessThan(user.getId(), monthStart, tomorrowStart);

        List<Instant> allReviews = sentenceReviewRepository.reviewInstantsForUser(user.getId());
        int longestStreak = longestStreakDays(allReviews, zoneId);
        int currentStreak = currentStreakDays(allReviews, zoneId, today);

        long attemptsTotal = pronunciationAttemptRepository.countByUser_Id(user.getId());
        long successfulAttempts = pronunciationAttemptRepository.countByUser_IdAndSuccessfulTrue(user.getId());
        Double averageSuccessfulTry = pronunciationAttemptRepository.averageSuccessfulAttemptNumberForUser(user.getId());

        Map<String, Object> summary = new LinkedHashMap<>();
        summary.put("reviewedToday", reviewedToday);
        summary.put("reviewedThisWeek", reviewedThisWeek);
        summary.put("reviewedThisMonth", reviewedThisMonth);
        summary.put("longestStreakDays", longestStreak);
        summary.put("currentStreakDays", currentStreak);
        summary.put("attemptsTotal", attemptsTotal);
        summary.put("successfulAttempts", successfulAttempts);
        summary.put("successRate", percentage(successfulAttempts, attemptsTotal));
        summary.put("averageSuccessfulTry", roundOne(averageSuccessfulTry));

        Instant chartStart = today.minusDays(CHART_DAYS - 1L).atStartOfDay(zoneId).toInstant();
        List<Instant> reviewInstants = sentenceReviewRepository.reviewInstantsForUserSince(user.getId(), chartStart);
        List<Object[]> attemptRows = pronunciationAttemptRepository.attemptsSinceForUser(user.getId(), chartStart);

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("summary", summary);
        result.put("timeline", buildTimeline(today, zoneId, reviewInstants, attemptRows));
        result.put("attemptDistribution", attemptDistribution(pronunciationAttemptRepository.successfulAttemptDistributionForUser(user.getId())));
        return result;
    }

    @Transactional(readOnly = true)
    public Map<String, Object> sentenceStats(UserAccount user, Long sentenceId) {
        Sentence sentence = sentenceRepository.findByIdAndUser(sentenceId, user.getId())
                .orElseThrow(() -> new NotFoundException("Sentence not found"));

        ZoneId zoneId = parseZone(user.getTimezone());
        LocalDate today = LocalDate.now(zoneId);
        Instant chartStart = today.minusDays(CHART_DAYS - 1L).atStartOfDay(zoneId).toInstant();

        long reviewCount = sentenceReviewRepository.countBySentence_IdAndUser_Id(sentenceId, user.getId());
        long reviewsLast30Days = sentenceReviewRepository.countBySentence_IdAndUser_IdAndReviewedAtGreaterThanEqual(sentenceId, user.getId(), chartStart);
        Instant lastReviewedAt = sentenceReviewRepository.lastReviewedAtForSentence(sentenceId, user.getId());
        long attemptsTotal = pronunciationAttemptRepository.countBySentence_IdAndUser_Id(sentenceId, user.getId());
        long successfulAttempts = pronunciationAttemptRepository.countBySentence_IdAndUser_IdAndSuccessfulTrue(sentenceId, user.getId());
        Double averageSuccessfulTry = pronunciationAttemptRepository.averageSuccessfulAttemptNumberForSentence(sentenceId, user.getId());

        List<Instant> reviewInstants = sentenceReviewRepository.reviewInstantsForSentenceSince(sentenceId, user.getId(), chartStart);
        List<Object[]> attemptRows = pronunciationAttemptRepository.attemptsSinceForSentence(sentenceId, user.getId(), chartStart);

        Map<String, Object> sentencePayload = new LinkedHashMap<>();
        sentencePayload.put("id", sentence.getId());
        sentencePayload.put("content", sentence.getContent());
        sentencePayload.put("listName", sentence.getSentenceList().getName());

        Map<String, Object> summary = new LinkedHashMap<>();
        summary.put("reviewCount", reviewCount);
        summary.put("reviewsLast30Days", reviewsLast30Days);
        summary.put("lastReviewedAt", lastReviewedAt);
        summary.put("attemptsTotal", attemptsTotal);
        summary.put("successfulAttempts", successfulAttempts);
        summary.put("successRate", percentage(successfulAttempts, attemptsTotal));
        summary.put("averageSuccessfulTry", roundOne(averageSuccessfulTry));

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("sentence", sentencePayload);
        result.put("summary", summary);
        result.put("timeline", buildTimeline(today, zoneId, reviewInstants, attemptRows));
        result.put("attemptDistribution", attemptDistribution(pronunciationAttemptRepository.successfulAttemptDistributionForSentence(sentenceId, user.getId())));
        return result;
    }

    private List<Map<String, Object>> buildTimeline(
            LocalDate today,
            ZoneId zoneId,
            List<Instant> reviewInstants,
            List<Object[]> attemptRows
    ) {
        Map<LocalDate, Long> reviewCounts = new HashMap<>();
        for (Instant instant : reviewInstants) {
            LocalDate date = instant.atZone(zoneId).toLocalDate();
            reviewCounts.merge(date, 1L, Long::sum);
        }

        Map<LocalDate, Long> attemptCounts = new HashMap<>();
        Map<LocalDate, Long> successfulAttemptCounts = new HashMap<>();
        for (Object[] row : attemptRows) {
            Instant instant = (Instant) row[0];
            boolean successful = Boolean.TRUE.equals(row[1]);
            LocalDate date = instant.atZone(zoneId).toLocalDate();
            attemptCounts.merge(date, 1L, Long::sum);
            if (successful) successfulAttemptCounts.merge(date, 1L, Long::sum);
        }

        List<Map<String, Object>> points = new ArrayList<>();
        LocalDate start = today.minusDays(CHART_DAYS - 1L);
        for (int i = 0; i < CHART_DAYS; i++) {
            LocalDate date = start.plusDays(i);
            long attempts = attemptCounts.getOrDefault(date, 0L);
            long successfulAttempts = successfulAttemptCounts.getOrDefault(date, 0L);
            Map<String, Object> point = new LinkedHashMap<>();
            point.put("date", date.toString());
            point.put("reviewed", reviewCounts.getOrDefault(date, 0L));
            point.put("attempts", attempts);
            point.put("successfulAttempts", successfulAttempts);
            point.put("successRate", percentage(successfulAttempts, attempts));
            points.add(point);
        }
        return points;
    }

    private List<Map<String, Object>> attemptDistribution(List<Object[]> rows) {
        return rows.stream().map(row -> {
            int attemptNumber = ((Number) row[0]).intValue();
            long count = ((Number) row[1]).longValue();
            Map<String, Object> point = new LinkedHashMap<>();
            point.put("attemptNumber", attemptNumber);
            point.put("count", count);
            return point;
        }).toList();
    }

    private int longestStreakDays(List<Instant> instants, ZoneId zoneId) {
        List<LocalDate> dates = distinctReviewDates(instants, zoneId);
        int longest = 0;
        int current = 0;
        LocalDate previous = null;
        for (LocalDate date : dates) {
            current = previous != null && date.equals(previous.plusDays(1)) ? current + 1 : 1;
            longest = Math.max(longest, current);
            previous = date;
        }
        return longest;
    }

    private int currentStreakDays(List<Instant> instants, ZoneId zoneId, LocalDate today) {
        Set<LocalDate> dates = new HashSet<>(distinctReviewDates(instants, zoneId));
        LocalDate cursor = dates.contains(today) ? today : today.minusDays(1);
        int streak = 0;
        while (dates.contains(cursor)) {
            streak++;
            cursor = cursor.minusDays(1);
        }
        return streak;
    }

    private List<LocalDate> distinctReviewDates(List<Instant> instants, ZoneId zoneId) {
        return instants.stream()
                .map(instant -> instant.atZone(zoneId).toLocalDate())
                .distinct()
                .sorted()
                .toList();
    }

    private ZoneId parseZone(String timezone) {
        try {
            return ZoneId.of(timezone);
        } catch (Exception ignored) {
            return ZoneOffset.UTC;
        }
    }

    private int clamp(Integer value, int min, int max) {
        if (value == null) return min;
        return Math.max(min, Math.min(max, value));
    }

    private String safeSource(String source) {
        if (source == null || source.isBlank()) return "REVIEW";
        String cleaned = source.trim().toUpperCase(Locale.ROOT).replaceAll("[^A-Z_]", "_");
        return cleaned.substring(0, Math.min(32, cleaned.length()));
    }

    private double percentage(long numerator, long denominator) {
        if (denominator <= 0) return 0.0;
        return roundOne((numerator * 100.0) / denominator);
    }

    private double roundOne(Double value) {
        if (value == null || value.isNaN() || value.isInfinite()) return 0.0;
        return Math.round(value * 10.0) / 10.0;
    }

    public record PronunciationAttemptRequest(
            Long sentenceId,
            Long reviewSessionId,
            Boolean successful,
            Integer attemptNumber,
            Integer stage,
            Integer partIndex,
            Integer partCount,
            String source
    ) {
    }
}
