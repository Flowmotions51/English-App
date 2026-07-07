package com.englishapp.api;

import com.englishapp.service.NaturalnessCheckService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/ai")
public class NaturalnessCheckController {
    private final NaturalnessCheckService naturalnessCheckService;

    public NaturalnessCheckController(NaturalnessCheckService naturalnessCheckService) {
        this.naturalnessCheckService = naturalnessCheckService;
    }

    @PostMapping(value = "/naturalness/check", produces = MediaType.APPLICATION_JSON_VALUE)
    public Map<String, Object> check(@RequestBody @Valid NaturalnessCheckRequest request) {
        NaturalnessCheckService.NaturalnessCheckResult result = naturalnessCheckService.check(
                request.text(),
                request.language(),
                request.listTitle()
        );
        return Map.of(
                "configured", result.configured(),
                "cached", result.cached(),
                "feedback", result.feedback()
        );
    }

    @GetMapping("/naturalness/configured")
    public Map<String, Boolean> configured() {
        return Map.of("configured", naturalnessCheckService.isConfigured());
    }

    public record NaturalnessCheckRequest(@NotBlank String text, String language, String listTitle) {
        public String language() {
            return language == null || language.isBlank() ? "en" : language;
        }

        public String listTitle() {
            return listTitle == null ? "" : listTitle.trim();
        }
    }
}
