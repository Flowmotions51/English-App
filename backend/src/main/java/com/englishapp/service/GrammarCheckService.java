package com.englishapp.service;

import org.languagetool.JLanguageTool;
import org.languagetool.Languages;
import org.languagetool.rules.RuleMatch;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.stream.Collectors;

/**
 * Lightweight local grammar check using LanguageTool (rule-based, runs in-process, no API key).
 * Normalizes input for case-insensitive checking and ignores apostrophe variants (curly/straight).
 */
@Service
public class GrammarCheckService {

    private static final String LANGUAGE_CODE = "en-US";

    private final JLanguageTool langTool;

    public GrammarCheckService() {
        this.langTool = new JLanguageTool(Languages.getLanguageForShortCode(LANGUAGE_CODE));
    }

    public boolean isConfigured() {
        return true;
    }

    /**
     * Normalize text so spell/grammar check ignores case and apostrophe style:
     * lowercase, and replace curly/smart apostrophes and backticks with straight apostrophe.
     */
    private static String normalizeForCheck(String text) {
        if (text == null) return "";
        String normalized = text
                .replace('\u2019', '\'')   // right single quotation mark (curly apostrophe)
                .replace('\u2018', '\'')   // left single quotation mark
                .replace('`', '\'');
        return normalized.toLowerCase();
    }

    public GrammarCheckResult check(String text) {
        if (text == null || text.isBlank()) {
            return new GrammarCheckResult(false, "No text provided.");
        }

        String normalized = normalizeForCheck(text);

        synchronized (langTool) {
            try {
                List<RuleMatch> matches = langTool.check(normalized);
                if (matches.isEmpty()) {
                    return new GrammarCheckResult(true, "Looks good! No grammar or spelling issues found.");
                }
                String feedback = matches.stream()
                        .map(m -> {
                            String msg = m.getMessage();
                            List<String> suggestions = m.getSuggestedReplacements();
                            if (suggestions != null && !suggestions.isEmpty()) {
                                msg += " → Suggested: \"" + String.join("\" or \"", suggestions.subList(0, Math.min(3, suggestions.size()))) + "\"";
                            }
                            return msg;
                        })
                        .collect(Collectors.joining(" • "));
                return new GrammarCheckResult(false, feedback);
            } catch (Exception e) {
                return new GrammarCheckResult(false, "Grammar check failed: " + e.getMessage());
            }
        }
    }

    public record GrammarCheckResult(boolean correct, String feedback) {
    }
}
