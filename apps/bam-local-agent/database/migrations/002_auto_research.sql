-- Automatic local research (community, demographics, schools, events, culture).
-- The app applies this itself on start (src/config/migrate.js); run it by hand only if the database user cannot ALTER.
-- Skip any line that fails with "Duplicate column name".

ALTER TABLE knowledge_chunks
  MODIFY chunk_type ENUM('playbook','demographic','school','event','community','culture') NOT NULL;

ALTER TABLE stores ADD COLUMN research_status VARCHAR(12) NOT NULL DEFAULT 'none';   -- none | pending | running | done | failed
ALTER TABLE stores ADD COLUMN research_error VARCHAR(255) NULL;
ALTER TABLE stores ADD COLUMN research_queued_at TIMESTAMP NULL DEFAULT NULL;
ALTER TABLE stores ADD COLUMN researched_at TIMESTAMP NULL DEFAULT NULL;
