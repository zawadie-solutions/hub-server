-- Company Research tables. All prefixed cr_ so they can share the hub's database with other
-- built-in solutions. Times are stored as UTC. Every statement is idempotent (run at each start).

CREATE TABLE IF NOT EXISTS cr_companies (
  id INT AUTO_INCREMENT PRIMARY KEY,
  company_name VARCHAR(300) NOT NULL,
  website VARCHAR(1000),
  address TEXT,
  city VARCHAR(255),
  state VARCHAR(255),
  country VARCHAR(255),
  business_phone VARCHAR(100),
  company_email VARCHAR(320),
  owner_name VARCHAR(300),
  owner_title VARCHAR(300),
  owner_phone VARCHAR(100),
  owner_email VARCHAR(320),
  decision_maker_name VARCHAR(300),
  decision_maker_title VARCHAR(300),
  decision_maker_phone VARCHAR(100),
  decision_maker_email VARCHAR(320),
  source VARCHAR(500),
  source_url TEXT,
  confidence DOUBLE,
  verification_status VARCHAR(20),
  research_status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  notes TEXT,
  date_researched DATETIME(6),
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  field_confidence JSON,
  is_demo TINYINT(1) NOT NULL DEFAULT 0,
  queued TINYINT(1) NOT NULL DEFAULT 0,
  provider_used VARCHAR(255),
  INDEX ix_cr_companies_name (company_name),
  INDEX ix_cr_companies_status (research_status)
) CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS cr_search_results (
  id INT AUTO_INCREMENT PRIMARY KEY,
  company_id INT NOT NULL,
  query TEXT NOT NULL,
  title TEXT,
  url TEXT,
  snippet MEDIUMTEXT,
  display_url TEXT,
  provider VARCHAR(50) NOT NULL,
  searched_at DATETIME(6) NOT NULL,
  INDEX ix_cr_search_results_company (company_id),
  CONSTRAINT fk_cr_search_results_company FOREIGN KEY (company_id) REFERENCES cr_companies(id) ON DELETE CASCADE
) CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS cr_research_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  company_id INT NOT NULL,
  step VARCHAR(60) NOT NULL,
  query TEXT,
  result TEXT,
  status VARCHAR(30) NOT NULL,
  timestamp DATETIME(6) NOT NULL,
  INDEX ix_cr_research_logs_company (company_id),
  CONSTRAINT fk_cr_research_logs_company FOREIGN KEY (company_id) REFERENCES cr_companies(id) ON DELETE CASCADE
) CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS cr_evidence (
  id INT AUTO_INCREMENT PRIMARY KEY,
  company_id INT NOT NULL,
  field VARCHAR(60) NOT NULL,
  value TEXT NOT NULL,
  detail VARCHAR(300),
  source_type VARCHAR(40) NOT NULL,
  source_title TEXT,
  source_url TEXT,
  snippet MEDIUMTEXT,
  score DOUBLE NOT NULL,
  selected TINYINT(1) NOT NULL DEFAULT 0,
  INDEX ix_cr_evidence_company (company_id),
  CONSTRAINT fk_cr_evidence_company FOREIGN KEY (company_id) REFERENCES cr_companies(id) ON DELETE CASCADE
) CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS cr_review_queue (
  id INT AUTO_INCREMENT PRIMARY KEY,
  company_id INT NOT NULL,
  field VARCHAR(60),
  issue TEXT NOT NULL,
  conflicting_information JSON,
  recommended_action TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
  resolution TEXT,
  created_at DATETIME(6) NOT NULL,
  INDEX ix_cr_review_queue_company (company_id),
  INDEX ix_cr_review_queue_status (status),
  CONSTRAINT fk_cr_review_queue_company FOREIGN KEY (company_id) REFERENCES cr_companies(id) ON DELETE CASCADE
) CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS cr_email_jobs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  kind VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  total INT NOT NULL DEFAULT 0,
  completed INT NOT NULL DEFAULT 0,
  failed INT NOT NULL DEFAULT 0,
  pending_items JSON,
  provider_used VARCHAR(255),
  is_demo TINYINT(1) NOT NULL DEFAULT 0,
  error TEXT,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  INDEX ix_cr_email_jobs_kind (kind),
  INDEX ix_cr_email_jobs_status (status)
) CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS cr_email_verifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  job_id INT,
  email VARCHAR(320) NOT NULL,
  status VARCHAR(30) NOT NULL,
  syntax_check VARCHAR(20) NOT NULL DEFAULT 'not_available',
  domain_check VARCHAR(20) NOT NULL DEFAULT 'not_available',
  mx_check VARCHAR(20) NOT NULL DEFAULT 'not_available',
  mailbox_check VARCHAR(20) NOT NULL DEFAULT 'not_available',
  disposable_status VARCHAR(20) NOT NULL DEFAULT 'not_available',
  role_based_status VARCHAR(20) NOT NULL DEFAULT 'not_available',
  catch_all_status VARCHAR(20) NOT NULL DEFAULT 'not_available',
  provider VARCHAR(50) NOT NULL,
  is_demo TINYINT(1) NOT NULL DEFAULT 0,
  provider_raw JSON,
  error TEXT,
  input_row JSON,
  verified_at DATETIME(6) NOT NULL,
  created_at DATETIME(6) NOT NULL,
  INDEX ix_cr_email_verifications_job (job_id),
  INDEX ix_cr_email_verifications_email (email),
  CONSTRAINT fk_cr_email_verifications_job FOREIGN KEY (job_id) REFERENCES cr_email_jobs(id) ON DELETE SET NULL
) CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS cr_discovered_emails (
  id INT AUTO_INCREMENT PRIMARY KEY,
  job_id INT,
  company_id INT,
  method VARCHAR(20) NOT NULL,
  company_name VARCHAR(300),
  domain VARCHAR(255),
  email VARCHAR(320) NOT NULL,
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  full_name VARCHAR(200),
  title VARCHAR(300),
  department VARCHAR(120),
  email_type VARCHAR(20),
  source_type VARCHAR(40),
  source_title TEXT,
  source_url TEXT,
  snippet MEDIUMTEXT,
  discovery_provider VARCHAR(50) NOT NULL,
  confidence DOUBLE,
  status VARCHAR(20) NOT NULL DEFAULT 'NOT_FOUND',
  is_demo TINYINT(1) NOT NULL DEFAULT 0,
  verification_id INT,
  verification_status VARCHAR(30),
  input_row JSON,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  INDEX ix_cr_discovered_emails_job (job_id),
  INDEX ix_cr_discovered_emails_company (company_id),
  INDEX ix_cr_discovered_emails_method (method),
  INDEX ix_cr_discovered_emails_domain (domain),
  INDEX ix_cr_discovered_emails_email (email),
  CONSTRAINT fk_cr_discovered_emails_job FOREIGN KEY (job_id) REFERENCES cr_email_jobs(id) ON DELETE SET NULL,
  CONSTRAINT fk_cr_discovered_emails_company FOREIGN KEY (company_id) REFERENCES cr_companies(id) ON DELETE SET NULL,
  CONSTRAINT fk_cr_discovered_emails_verification FOREIGN KEY (verification_id) REFERENCES cr_email_verifications(id) ON DELETE SET NULL
) CHARACTER SET utf8mb4;

-- Settings, search-provider choices and API keys entered on the Settings page. Kept in the
-- database (not files) so they survive a redeploy.
CREATE TABLE IF NOT EXISTS cr_config (
  name VARCHAR(100) PRIMARY KEY,
  value MEDIUMTEXT NOT NULL,
  updated_at DATETIME(6) NOT NULL
) CHARACTER SET utf8mb4;
