package com.englishapp.api;

import com.englishapp.model.UserAccount;
import com.englishapp.service.CurrentUserService;
import com.englishapp.service.ReviewService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/reviews")
public class ReviewController {
    private final CurrentUserService currentUserService;
    private final ReviewService reviewService;

    public ReviewController(CurrentUserService currentUserService, ReviewService reviewService) {
        this.currentUserService = currentUserService;
        this.reviewService = reviewService;
    }

    @GetMapping("/pending")
    public List<Map<String, Object>> pendingReviews() {
        UserAccount user = currentUserService.getCurrentUser();
        return reviewService.pendingSessions(user);
    }

    @PostMapping("/refresh-sessions")
    public void refreshReviews() {
        UserAccount user = currentUserService.getCurrentUser();
        reviewService.refreshPendingSessions(user);
    }

    @PostMapping("/sessions/{sessionId}/open")
    public ResponseEntity<Map<String, String>> openSession(@PathVariable Long sessionId) {
        reviewService.openSession(currentUserService.getCurrentUser(), sessionId);
        return ResponseEntity.ok(Map.of("status", "ok"));
    }

    @PostMapping("/sessions/{sessionId}/complete")
    public ResponseEntity<Map<String, Object>> completeSession(
            @PathVariable Long sessionId,
            @RequestBody(required = false) CompleteSessionRequest body
    ) {
        List<Long> sentenceIds = body != null ? body.sentenceIds() : null;
        int remaining = reviewService.completeSession(currentUserService.getCurrentUser(), sessionId, sentenceIds);
        return ResponseEntity.ok(Map.of("status", "ok", "remainingCount", remaining));
    }

    public record CompleteSessionRequest(List<Long> sentenceIds) {
    }

    @PostMapping("/sentences/{sentenceId}/complete")
    public ResponseEntity<Map<String, Object>> completeSentenceFromListReview(@PathVariable Long sentenceId) {
        return ResponseEntity.ok(reviewService.completeSentenceFromListReview(
                currentUserService.getCurrentUser(),
                sentenceId
        ));
    }
}
