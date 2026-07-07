CREATE TABLE pronunciation_attempts (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sentence_id BIGINT NOT NULL REFERENCES sentences(id) ON DELETE CASCADE,
    review_session_id BIGINT NULL REFERENCES review_sessions(id) ON DELETE SET NULL,
    successful BOOLEAN NOT NULL,
    attempt_number INTEGER NOT NULL DEFAULT 1,
    stage INTEGER NULL,
    part_index INTEGER NULL,
    part_count INTEGER NULL,
    source VARCHAR(32) NOT NULL DEFAULT 'REVIEW',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_pronunciation_attempts_user_created ON pronunciation_attempts(user_id, created_at);
CREATE INDEX idx_pronunciation_attempts_sentence_created ON pronunciation_attempts(sentence_id, created_at);
CREATE INDEX idx_pronunciation_attempts_user_sentence ON pronunciation_attempts(user_id, sentence_id);
