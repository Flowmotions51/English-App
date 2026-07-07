CREATE TABLE ai_check_cache (
    id BIGSERIAL PRIMARY KEY,
    cache_key VARCHAR(64) NOT NULL UNIQUE,
    language VARCHAR(8) NOT NULL,
    model VARCHAR(128) NOT NULL,
    prompt_version VARCHAR(32) NOT NULL,
    response_text TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ai_check_cache_last_used_at ON ai_check_cache(last_used_at);
CREATE INDEX idx_ai_check_cache_prompt_model_language ON ai_check_cache(prompt_version, model, language);
