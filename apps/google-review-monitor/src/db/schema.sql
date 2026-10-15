-- MySQL 8 schema. Created on startup if missing (see migrate() in db.ts).
--
-- Collation utf8mb4_0900_as_cs: text compares exactly (case, accents and trailing spaces all
-- count), so two Asana locations that differ only that way stay separate, while sorting is
-- still alphabetical. Times are DATETIME(3) holding UTC.

CREATE TABLE IF NOT EXISTS reviews (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  asana_task_id VARCHAR(64) NOT NULL,
  asana_task_name TEXT NOT NULL,
  asana_task_url TEXT NOT NULL,
  location VARCHAR(1024),
  month VARCHAR(1024),
  reviewer_name VARCHAR(1024),
  rating INT,
  review_text TEXT,
  google_review_url TEXT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'UNKNOWN',
  first_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_checked_at DATETIME(3),
  removed_at DATETIME(3),
  notification_sent TINYINT(1) NOT NULL DEFAULT 0,
  notification_sent_at DATETIME(3),
  notification_attempts INT NOT NULL DEFAULT 0,
  last_notification_error TEXT,
  last_error TEXT,
  monitoring_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  -- The Asana project (month) a review came from. `month` is just a display label (the
  -- container task's name, which doesn't match the project's own name). This is the real key.
  asana_project_gid VARCHAR(64),
  -- Who is working on it, from Asana: the dispute task's assignee and the location task's assignee.
  assignee_name VARCHAR(255),
  location_assignee_name VARCHAR(255),
  UNIQUE KEY uq_reviews_asana_task (asana_task_id),
  KEY idx_reviews_project_location (asana_project_gid, location(191)),
  KEY idx_reviews_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

CREATE TABLE IF NOT EXISTS review_check_history (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  review_id BIGINT NOT NULL,
  checked_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  result VARCHAR(32) NOT NULL,
  reason TEXT,
  KEY idx_history_review (review_id),
  KEY idx_history_checked_at (checked_at),
  CONSTRAINT fk_history_review FOREIGN KEY (review_id) REFERENCES reviews (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

-- Tracks every "<Month> Managed Disputes <Year>" Asana project found, so the dashboard can
-- list all of them (synced or not) and know whether a run is currently in progress.
CREATE TABLE IF NOT EXISTS asana_month_projects (
  project_gid VARCHAR(64) NOT NULL PRIMARY KEY,
  display_name VARCHAR(1024) NOT NULL,
  last_synced_at DATETIME(3),
  last_review_count INT,
  run_status VARCHAR(32) NOT NULL DEFAULT 'idle',
  last_run_error TEXT,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

-- Who did what, and when: runs started/finished/cancelled, single-location checks, settings
-- changes, and what the scheduler did. Shown on the dashboard's Audit page. Append-only.
CREATE TABLE IF NOT EXISTS audit_log (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  actor VARCHAR(255) NOT NULL,
  action VARCHAR(64) NOT NULL,
  summary TEXT NOT NULL,
  KEY idx_audit_action (action)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;

-- Settings changed from the dashboard's Configure page. A name present here overrides the
-- value from .env. Deleting the row falls back to .env again.
CREATE TABLE IF NOT EXISTS app_settings (
  name VARCHAR(64) NOT NULL PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_by VARCHAR(255)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_cs;
