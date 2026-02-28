CREATE TABLE users (
    id BIGSERIAL PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    timezone VARCHAR(64) NOT NULL DEFAULT 'UTC',
    merge_window_minutes INTEGER NOT NULL DEFAULT 60,
    weekly_review_day INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE sentence_lists (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE sentences (
    id BIGSERIAL PRIMARY KEY,
    list_id BIGINT NOT NULL REFERENCES sentence_lists(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE schedule_templates (
    id BIGSERIAL PRIMARY KEY,
    sentence_id BIGINT NOT NULL UNIQUE REFERENCES sentences(id) ON DELETE CASCADE,
    open_ended BOOLEAN NOT NULL DEFAULT TRUE,
    end_date DATE NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE sentence_schedule_steps (
    id BIGSERIAL PRIMARY KEY,
    schedule_template_id BIGINT NOT NULL REFERENCES schedule_templates(id) ON DELETE CASCADE,
    step_order INTEGER NOT NULL,
    offset_minutes INTEGER NOT NULL,
    UNIQUE(schedule_template_id, step_order)
);

CREATE TABLE review_sessions (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    start_at TIMESTAMPTZ NOT NULL,
    end_at TIMESTAMPTZ NOT NULL,
    status VARCHAR(32) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE review_session_items (
    id BIGSERIAL PRIMARY KEY,
    review_session_id BIGINT NOT NULL REFERENCES review_sessions(id) ON DELETE CASCADE,
    sentence_id BIGINT NOT NULL REFERENCES sentences(id) ON DELETE CASCADE,
    due_at TIMESTAMPTZ NOT NULL,
    UNIQUE(review_session_id, sentence_id)
);

CREATE TABLE review_notifications (
    id BIGSERIAL PRIMARY KEY,
    review_session_id BIGINT NOT NULL UNIQUE REFERENCES review_sessions(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE sentence_reviews (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sentence_id BIGINT NOT NULL REFERENCES sentences(id) ON DELETE CASCADE,
    review_session_id BIGINT NULL REFERENCES review_sessions(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sentence_lists_user_id ON sentence_lists(user_id);
CREATE INDEX idx_sentences_list_id ON sentences(list_id);
CREATE INDEX idx_review_sessions_user_status_start ON review_sessions(user_id, status, start_at);
CREATE INDEX idx_sentence_reviews_sentence_id ON sentence_reviews(sentence_id);
