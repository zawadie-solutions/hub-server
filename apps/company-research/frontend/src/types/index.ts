export interface FieldConfidence {
  confidence: number;
  status: string;
}

export interface Company {
  id: number;
  company_name: string;
  website: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  business_phone: string | null;
  company_email: string | null;
  owner_name: string | null;
  owner_title: string | null;
  owner_phone: string | null;
  owner_email: string | null;
  decision_maker_name: string | null;
  decision_maker_title: string | null;
  decision_maker_phone: string | null;
  decision_maker_email: string | null;
  source: string | null;
  source_url: string | null;
  confidence: number | null;
  verification_status: string | null;
  research_status: string;
  notes: string | null;
  date_researched: string | null;
  created_at: string;
  updated_at: string;
  field_confidence: Record<string, FieldConfidence> | null;
  is_demo: boolean;
  provider_used: string | null;
}

export type EditableField =
  | "company_name" | "website" | "address" | "city" | "state" | "country" | "business_phone"
  | "company_email" | "owner_name" | "owner_title" | "owner_phone" | "owner_email"
  | "decision_maker_name" | "decision_maker_title" | "decision_maker_phone"
  | "decision_maker_email" | "notes";

export interface SearchResult {
  id: number;
  company_id: number;
  company_name?: string;
  query: string;
  title: string | null;
  url: string | null;
  snippet: string | null;
  provider: string;
  searched_at: string;
}

export interface LogEntry {
  id: number;
  step: string;
  query: string | null;
  result: string | null;
  status: string;
  timestamp: string;
}

export interface Evidence {
  id: number;
  field: string;
  value: string;
  detail: string | null;
  source_type: string;
  source_title: string | null;
  source_url: string | null;
  snippet: string | null;
  score: number;
  selected: boolean;
}

export interface Candidate {
  value: string;
  detail: string;
  confidence: number;
  source_type: string;
  source_title: string;
  source_url: string;
  snippet: string;
  sources: number;
}

export interface ReviewItem {
  id: number;
  company_id: number;
  company_name: string | null;
  field: string | null;
  issue: string;
  conflicting_information: Candidate[] | null;
  recommended_action: string | null;
  status: string;
  resolution: string | null;
  created_at: string;
}

export interface CompanyDetail {
  company: Company;
  evidence: Evidence[];
  logs: LogEntry[];
  search_results: SearchResult[];
  reviews: ReviewItem[];
  source_labels: Record<string, string>;
}

export interface Dashboard {
  total: number;
  completed: number;
  researching: number;
  pending: number;
  owner_found: number;
  owner_not_found: number;
  contact_found: number;
  needs_review: number;
  failed: number;
  demo_records: number;
  open_reviews: number;
  demo_mode: boolean;
}

export interface Step {
  key: string;
  label: string;
  state: "pending" | "running" | "done" | "failed" | "skipped";
  detail: string;
}

export interface JobStatus {
  state: "idle" | "running" | "paused" | "stopping";
  restored: boolean;
  total: number;
  completed: number;
  failed: number;
  remaining: number;
  current: { company_id: number; company_name: string; steps: Step[] }[];
  recent: {
    company_id: number;
    company_name: string;
    research_status: string;
    verification_status: string | null;
    confidence: number | null;
    owner_name: string | null;
  }[];
  events: { kind: string; provider: string; query: string; detail: string; time: number }[];
  providers: string[];
  demo_mode: boolean;
}

export interface ProviderInfo {
  name: string;
  label: string;
  is_demo: boolean;
  enabled: boolean;
  configured: boolean;
  required_env: string[];
  env_set: Record<string, boolean>;
}

export interface AppSettings {
  max_queries_per_company: number;
  max_results_per_query: number;
  request_delay_seconds: number;
  max_retries: number;
  max_concurrent_searches: number;
  fetch_official_pages: boolean;
  source_scores: Record<string, number>;
  thresholds: { verified: number; likely: number; uncertain: number; conflict_min_score: number };
}

export interface SettingsResponse {
  settings: AppSettings;
  default_provider: string;
  secondary_provider: string | null;
  providers: ProviderInfo[];
  active_chain: string[];
  demo_mode: boolean;
  source_labels: Record<string, string>;
}

export interface ImportSummary {
  rows: number;
  imported: number;
  duplicates: { company_name: string; existing_id: number; reason: string }[];
  company_ids: number[];
}

export interface ExportFile {
  filename: string;
  size: number;
  created_at: string;
}

export type Page =
  | "dashboard" | "companies" | "research" | "review" | "results" | "exports" | "settings"
  | "email-research";

export type EmailTab = "domain_search" | "find_by_company" | "find_by_name" | "verify";

// ============================================================== email research
export interface DiscoveredEmail {
  id: number;
  job_id: number | null;
  company_id: number | null;
  method: "domain_search" | "find_by_company" | "find_by_name";
  company_name: string | null;
  domain: string | null;
  email: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  title: string | null;
  department: string | null;
  email_type: "personal" | "generic" | null;
  source_type: string | null;
  source_title: string | null;
  source_url: string | null;
  snippet: string | null;
  discovery_provider: string;
  confidence: number | null;
  status: string;
  is_demo: boolean;
  verification_status: string | null;
  created_at: string;
  updated_at: string;
}

export interface EmailVerificationResult {
  id: number;
  job_id: number | null;
  email: string;
  status: string;
  syntax_check: string;
  domain_check: string;
  mx_check: string;
  mailbox_check: string;
  disposable_status: string;
  role_based_status: string;
  catch_all_status: string;
  provider: string;
  is_demo: boolean;
  provider_raw: Record<string, unknown> | null;
  error: string | null;
  input_row: Record<string, string> | null;
  verified_at: string;
}

export interface EmailProviderInfo {
  name: string;
  label: string;
  is_demo: boolean;
  configured: boolean;
  required_env: string[];
  env_set: Record<string, boolean>;
}

export interface EmailProvidersResponse {
  discovery: EmailProviderInfo[];
  verification: EmailProviderInfo[];
  active_discovery: string;
  active_discovery_demo: boolean;
  active_verification: string;
}

export type EmailJobKind = "domain_search" | "find_by_company" | "find_by_name" | "verify";

export interface EmailJobStatus {
  state: "idle" | "running" | "paused" | "stopping";
  job_id: number | null;
  kind: EmailJobKind | "";
  restored: boolean;
  total: number;
  completed: number;
  failed: number;
  remaining: number;
  current_item: Record<string, string> | null;
  recent: (Record<string, string> & { ok: boolean })[];
  provider_used: string;
  is_demo: boolean;
  started_at: number | null;
  deduplicated?: number;
}

export interface UploadedTable {
  headers: string[];
  rows: string[][];
  truncated: boolean;
}

export interface EmailExportFile {
  filename: string;
  size: number;
  created_at: string;
}
