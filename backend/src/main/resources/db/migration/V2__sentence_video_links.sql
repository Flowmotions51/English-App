CREATE TABLE sentence_video_links (
    id BIGSERIAL PRIMARY KEY,
    sentence_id BIGINT NOT NULL REFERENCES sentences(id) ON DELETE CASCADE,
    url VARCHAR(2048) NOT NULL,
    time_code_seconds INTEGER NULL,
    label VARCHAR(255) NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sentence_video_links_sentence_id ON sentence_video_links(sentence_id);
