ALTER TABLE sentence_lists ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE sentence_lists SET updated_at = created_at;