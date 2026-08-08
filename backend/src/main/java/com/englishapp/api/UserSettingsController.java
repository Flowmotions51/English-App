package com.englishapp.api;

import com.englishapp.model.UserAccount;
import com.englishapp.repository.UserAccountRepository;
import com.englishapp.service.CurrentUserService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/settings")
public class UserSettingsController {
    private final CurrentUserService currentUserService;
    private final UserAccountRepository userAccountRepository;

    public UserSettingsController(CurrentUserService currentUserService, UserAccountRepository userAccountRepository) {
        this.currentUserService = currentUserService;
        this.userAccountRepository = userAccountRepository;
    }

    @GetMapping
    public Map<String, Object> getSettings() {
        UserAccount user = currentUserService.getCurrentUser();
        return payload(user);
    }

    @PutMapping
    public Map<String, Object> updateSettings(@RequestBody @Valid SettingsRequest request) {
        UserAccount user = currentUserService.getCurrentUser();
        user.setTimezone(request.timezone());
        user.setLanguage(normalizeLanguage(request.language()));
        user.setMergeWindowMinutes(request.mergeWindowMinutes());
        user.setWeeklyReviewDay(request.weeklyReviewDay());
        user.setAutoExcludeAfterReviews(request.autoExcludeAfterReviews());
        userAccountRepository.save(user);
        return payload(user);
    }

    private Map<String, Object> payload(UserAccount user) {
        return Map.of(
                "timezone", user.getTimezone(),
                "language", user.getLanguage(),
                "mergeWindowMinutes", user.getMergeWindowMinutes(),
                "weeklyReviewDay", user.getWeeklyReviewDay(),
                "autoExcludeAfterReviews", user.getAutoExcludeAfterReviews()
        );
    }

    private static String normalizeLanguage(String language) {
        return "sr".equalsIgnoreCase(language) ? "sr" : "en";
    }

    public record SettingsRequest(
            @NotBlank String timezone,
            @NotBlank @Pattern(regexp = "en|sr", message = "Language must be en or sr") String language,
            @Min(10) @Max(10080) Integer mergeWindowMinutes,
            @Min(1) @Max(7) Integer weeklyReviewDay,
            @Min(0) @Max(1000) Integer autoExcludeAfterReviews
    ) {
    }
}
