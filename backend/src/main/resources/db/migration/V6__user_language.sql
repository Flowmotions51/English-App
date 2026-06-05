ALTER TABLE users
    ADD COLUMN language VARCHAR(8) NOT NULL DEFAULT 'en';

ALTER TABLE users
    ADD CONSTRAINT users_language_check CHECK (language IN ('en', 'sr'));
