-- BAM Local Agent System - MySQL / MariaDB (InnoDB) schema
-- Import into the empty database named in DB_NAME (phpMyAdmin > Import).

CREATE TABLE IF NOT EXISTS stores (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  location_id VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(150) NOT NULL,
  address VARCHAR(255) NULL,
  city VARCHAR(100) NOT NULL,
  state CHAR(2) NOT NULL,
  zip VARCHAR(10) NULL,
  profile JSON NULL,            -- free-form store profile (demographics summary, neighborhood notes, etc.)
  research_status VARCHAR(12) NOT NULL DEFAULT 'none',   -- automatic local research: none | pending | running | done | failed
  research_error VARCHAR(255) NULL,
  research_queued_at TIMESTAMP NULL DEFAULT NULL,
  researched_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS playbooks (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  quarter TINYINT UNSIGNED NOT NULL,
  year SMALLINT UNSIGNED NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 0,
  filename VARCHAR(255) NOT NULL,
  uploaded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_playbooks_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- location_id NULL = shared by all stores (the playbook text itself).
-- embedding = JSON array of floats stored as text.
-- quarter   = tag like '2026-Q2' for playbook chunks (NULL for local data).
-- is_active = only active chunks are searched; playbook chunks flip when a playbook is activated.
CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  location_id VARCHAR(50) NULL,
  playbook_id INT UNSIGNED NULL,
  chunk_type ENUM('playbook','demographic','school','event','community','culture') NOT NULL,
  content TEXT NOT NULL,
  metadata JSON NULL,
  embedding MEDIUMTEXT NOT NULL,
  quarter VARCHAR(7) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_chunks_search (is_active, location_id),
  INDEX idx_chunks_playbook (playbook_id),
  INDEX idx_chunks_type (chunk_type),
  CONSTRAINT fk_chunks_playbook FOREIGN KEY (playbook_id) REFERENCES playbooks(id) ON DELETE CASCADE,
  CONSTRAINT fk_chunks_store FOREIGN KEY (location_id) REFERENCES stores(location_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO stores (location_id, name, city, state) VALUES
  ('smyrna-ga', 'BAM Smyrna', 'Smyrna', 'GA'),
  ('port-charlotte-fl', 'BAM Port Charlotte', 'Port Charlotte', 'FL'),
  ('orem-ut', 'BAM Orem', 'Orem', 'UT');
