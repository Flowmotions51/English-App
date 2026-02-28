package com.englishapp.api;

import com.englishapp.model.UserAccount;
import com.englishapp.repository.UserAccountRepository;
import com.englishapp.service.CurrentUserService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
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
        user.setMergeWindowMinutes(request.mergeWindowMinutes());
        user.setWeeklyReviewDay(request.weeklyReviewDay());
        userAccountRepository.save(user);
        return payload(user);
    }

    private Map<String, Object> payload(UserAccount user) {
        return Map.of(
                "timezone", user.getTimezone(),
                "mergeWindowMinutes", user.getMergeWindowMinutes(),
                "weeklyReviewDay", user.getWeeklyReviewDay()
        );
    }

    public record SettingsRequest(
            @NotBlank String timezone,
            @Min(10) @Max(10080) Integer mergeWindowMinutes,
            @Min(1) @Max(7) Integer weeklyReviewDay
    ) {
    }
}
