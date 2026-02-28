package com.englishapp.api;

import com.englishapp.service.GrammarCheckService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api")
public class GrammarCheckController {

    private final GrammarCheckService grammarCheckService;

    public GrammarCheckController(GrammarCheckService grammarCheckService) {
        this.grammarCheckService = grammarCheckService;
    }

    @PostMapping(value = "/grammar/check", produces = MediaType.APPLICATION_JSON_VALUE)
    public Map<String, Object> check(@RequestBody @Valid GrammarCheckRequest request) {
        GrammarCheckService.GrammarCheckResult result = grammarCheckService.check(request.text());
        return Map.of(
                "correct", result.correct(),
                "feedback", result.feedback()
        );
    }

    @GetMapping("/grammar/configured")
    public Map<String, Boolean> configured() {
        return Map.of("configured", grammarCheckService.isConfigured());
    }

    public record GrammarCheckRequest(@NotBlank String text) {
    }
}
