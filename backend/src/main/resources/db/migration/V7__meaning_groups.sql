CREATE TABLE meaning_groups (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label TEXT,                    -- optional: "ask for help politely"
    notes TEXT,                    -- optional: context, when to use which variant
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE sentences
    ADD COLUMN meaning_group_id BIGINT NULL
    REFERENCES meaning_groups(id) ON DELETE SET NULL;
CREATE INDEX idx_sentences_meaning_group ON sentences(meaning_group_id);