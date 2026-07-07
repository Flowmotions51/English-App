package com.englishapp.service;

import com.englishapp.model.AiCheckCache;
import com.englishapp.repository.AiCheckCacheRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.client.RestClient;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Map;

@Service
public class NaturalnessCheckService {
    private static final String ANTHROPIC_VERSION = "2023-06-01";
    private static final String PROMPT_VERSION = "naturalness-v2";

    private final RestClient restClient;
    private final AiCheckCacheRepository aiCheckCacheRepository;
    private final String apiKey;
    private final String model;
    private final int maxTokens;

    public NaturalnessCheckService(
            AiCheckCacheRepository aiCheckCacheRepository,
            @Value("${anthropic.api-key:}") String apiKey,
            @Value("${anthropic.model:claude-3-5-sonnet-20241022}") String model,
            @Value("${anthropic.max-tokens:700}") int maxTokens
    ) {
        this.aiCheckCacheRepository = aiCheckCacheRepository;
        this.apiKey = apiKey == null ? "" : apiKey.trim();
        this.model = model == null || model.isBlank() ? "claude-3-5-sonnet-20241022" : model.trim();
        this.maxTokens = Math.max(200, Math.min(1500, maxTokens));
        this.restClient = RestClient.builder()
                .baseUrl("https://api.anthropic.com")
                .build();
    }

    public boolean isConfigured() {
        return !apiKey.isBlank();
    }

    @Transactional
    public NaturalnessCheckResult check(String sentence, String language, String listTitle) {
        if (sentence == null || sentence.isBlank()) {
            return new NaturalnessCheckResult(false, false, "No sentence provided.");
        }
        if (!isConfigured()) {
            return new NaturalnessCheckResult(false, false, "Claude API is not configured. Set ANTHROPIC_API_KEY on the backend.");
        }

        String normalizedLanguage = normalizeLanguage(language);
        String normalizedSentence = normalizeSentence(sentence);
        String normalizedListTitle = normalizeListTitle(listTitle);
        String cacheKey = cacheKey(normalizedSentence, normalizedLanguage, normalizedListTitle);
        var cached = aiCheckCacheRepository.findByCacheKey(cacheKey);
        if (cached.isPresent()) {
            AiCheckCache hit = cached.get();
            hit.setLastUsedAt(Instant.now());
            return new NaturalnessCheckResult(true, true, hit.getResponseText());
        }

        try {
            Map<String, Object> response = restClient.post()
                    .uri("/v1/messages")
                    .header("x-api-key", apiKey)
                    .header("anthropic-version", ANTHROPIC_VERSION)
                    .body(Map.of(
                            "model", model,
                            "max_tokens", maxTokens,
                            "system", systemPrompt(normalizedLanguage),
                            "messages", List.of(Map.of(
                                    "role", "user",
                                    "content", userPrompt(normalizedSentence, normalizedListTitle)
                            ))
                    ))
                    .retrieve()
                    .body(new ParameterizedTypeReference<>() {
                    });

            String feedback = extractText(response);
            if (feedback.isBlank()) {
                return new NaturalnessCheckResult(true, false, "Claude returned an empty response.");
            }
            saveCache(cacheKey, normalizedLanguage, feedback);
            return new NaturalnessCheckResult(true, false, feedback);
        } catch (Exception e) {
            return new NaturalnessCheckResult(true, false, "AI check failed: " + e.getMessage());
        }
    }

    private String systemPrompt(String language) {
        String target = "sr".equalsIgnoreCase(language) ? "Serbian/Croatian learner" : "English learner";
        return """
                You are a native speaker of American English and an experienced usage editor.
                Evaluate whether a sentence sounds natural in contemporary US English for an %s.
                Check grammar, collocations, word choice, idioms, slang, jargon, register, tone, and pragmatic fit.
                Be concise, practical, and specific. If the sentence is natural, say so and mention any register notes.
                If it is unnatural, give one best natural alternative and briefly explain why.
                Do not over-correct valid informal English. Do not rewrite named entities or intentional style unless needed.
                """.formatted(target);
    }

    private String userPrompt(String sentence, String listTitle) {
        String context = listTitle.isBlank()
                ? "No list title was provided."
                : "List title / learner context: \"%s\"".formatted(listTitle);
        return """
                Does this sound natural to you as contemporary American English?

                Context:
                %s

                Sentence:
                "%s"

                Respond in this format:
                Verdict: Natural / Mostly natural / Unnatural
                Better version: <one sentence, or "No change needed">
                Notes: <short explanation covering grammar, collocations, idioms/slang/jargon/register if relevant>
                """.formatted(context, sentence.trim());
    }

    private void saveCache(String cacheKey, String language, String feedback) {
        AiCheckCache entry = new AiCheckCache();
        entry.setCacheKey(cacheKey);
        entry.setLanguage(language);
        entry.setModel(model);
        entry.setPromptVersion(PROMPT_VERSION);
        entry.setResponseText(feedback);
        entry.setCreatedAt(Instant.now());
        entry.setLastUsedAt(Instant.now());
        aiCheckCacheRepository.save(entry);
    }

    private String normalizeLanguage(String language) {
        return "sr".equalsIgnoreCase(language) ? "sr" : "en";
    }

    private String normalizeSentence(String sentence) {
        return sentence == null ? "" : sentence.trim().replaceAll("\\s+", " ");
    }

    private String normalizeListTitle(String listTitle) {
        return listTitle == null ? "" : listTitle.trim().replaceAll("\\s+", " ");
    }

    private String cacheKey(String normalizedSentence, String language, String normalizedListTitle) {
        String material = String.join("|",
                PROMPT_VERSION,
                model,
                language,
                normalizedListTitle.toLowerCase(Locale.ROOT),
                normalizedSentence.toLowerCase(Locale.ROOT)
        );
        return sha256(material);
    }

    private String sha256(String material) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest(material.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new IllegalStateException("SHA-256 is not available", e);
        }
    }

    @SuppressWarnings("unchecked")
    private String extractText(Map<String, Object> response) {
        if (response == null) return "";
        Object content = response.get("content");
        if (!(content instanceof List<?> blocks)) return "";
        StringBuilder out = new StringBuilder();
        for (Object block : blocks) {
            if (block instanceof Map<?, ?> map) {
                Object type = map.get("type");
                Object text = map.get("text");
                if ("text".equals(type) && text != null) {
                    if (!out.isEmpty()) out.append("\n\n");
                    out.append(text);
                }
            }
        }
        return out.toString().trim();
    }

    public record NaturalnessCheckResult(boolean configured, boolean cached, String feedback) {
    }
}
