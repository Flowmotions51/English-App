package com.englishapp.api;

import com.englishapp.model.UserAccount;
import com.englishapp.service.CurrentUserService;
import com.englishapp.service.StatsService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/stats")
public class StatsController {
    private final CurrentUserService currentUserService;
    private final StatsService statsService;

    public StatsController(CurrentUserService currentUserService, StatsService statsService) {
        this.currentUserService = currentUserService;
        this.statsService = statsService;
    }

    @GetMapping
    public Map<String, Object> overview() {
        UserAccount user = currentUserService.getCurrentUser();
        return statsService.overview(user);
    }

    @GetMapping("/sentences/{sentenceId}")
    public Map<String, Object> sentenceStats(@PathVariable Long sentenceId) {
        UserAccount user = currentUserService.getCurrentUser();
        return statsService.sentenceStats(user, sentenceId);
    }

    @PostMapping("/pronunciation-attempts")
    public ResponseEntity<Map<String, Object>> recordPronunciationAttempt(@RequestBody @Valid PronunciationAttemptRequest request) {
        UserAccount user = currentUserService.getCurrentUser();
        return ResponseEntity.ok(statsService.recordPronunciationAttempt(user, new StatsService.PronunciationAttemptRequest(
                request.sentenceId(),
                request.reviewSessionId(),
                request.successful(),
                request.attemptNumber(),
                request.stage(),
                request.partIndex(),
                request.partCount(),
                request.source()
        )));
    }

    public record PronunciationAttemptRequest(
            @NotNull Long sentenceId,
            Long reviewSessionId,
            @NotNull Boolean successful,
            Integer attemptNumber,
            Integer stage,
            Integer partIndex,
            Integer partCount,
            String source
    ) {
    }
}
