/** Status vocabularies and row shapes (tables are in db/schema.sql). */

// research_status values
export const PENDING = "PENDING";
export const RESEARCHING = "RESEARCHING";
export const COMPLETED = "COMPLETED";
export const NEEDS_REVIEW = "NEEDS_REVIEW";
export const FAILED = "FAILED";
// verification_status values
export const VERIFIED = "VERIFIED";
export const LIKELY = "LIKELY";
export const UNCERTAIN = "UNCERTAIN";
export const NOT_FOUND = "NOT_FOUND";
export const CONFLICT = "CONFLICT";

// EmailJob.kind values
export const DOMAIN_SEARCH = "domain_search";
export const FIND_BY_COMPANY = "find_by_company";
export const FIND_BY_NAME = "find_by_name";
export const VERIFY = "verify";
// EmailJob.status values (distinct from the company research-job vocabulary above)
export const JOB_PENDING = "PENDING";
export const JOB_RUNNING = "RUNNING";
export const JOB_PAUSED = "PAUSED";
export const JOB_COMPLETED = "COMPLETED";
export const JOB_STOPPED = "STOPPED";
// DiscoveredEmail.email_type values
export const EMAIL_PERSONAL = "personal";
export const EMAIL_GENERIC = "generic";

export type FieldConfidence = Record<string, { confidence: number; status: string }>;

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
  date_researched: Date | null;
  created_at: Date;
  updated_at: Date;
  field_confidence: FieldConfidence | null;
  is_demo: boolean;
  queued: boolean;
  provider_used: string | null;
}

/** Columns a research run or a manual edit may change (everything but the keys and timestamps). */
export const COMPANY_FIELDS = [
  "company_name", "website", "address", "city", "state", "country", "business_phone", "company_email",
  "owner_name", "owner_title", "owner_phone", "owner_email", "decision_maker_name", "decision_maker_title",
  "decision_maker_phone", "decision_maker_email", "source", "source_url", "confidence", "verification_status",
  "research_status", "notes", "date_researched", "field_confidence", "is_demo", "queued", "provider_used",
] as const satisfies readonly (keyof Company)[];

export interface SearchResultRow {
  id: number;
  company_id: number;
  query: string;
  title: string | null;
  url: string | null;
  snippet: string | null;
  display_url: string | null;
  provider: string;
  searched_at: Date;
}

export interface ResearchLog {
  id: number;
  company_id: number;
  step: string;
  query: string | null;
  result: string | null;
  status: string;
  timestamp: Date;
}

export interface Evidence {
  id: number;
  company_id: number;
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

export interface ReviewItem {
  id: number;
  company_id: number;
  field: string | null;
  issue: string;
  conflicting_information: Record<string, unknown>[] | null;
  recommended_action: string | null;
  status: string;
  resolution: string | null;
  created_at: Date;
}

export interface EmailJob {
  id: number;
  kind: string;
  status: string;
  total: number;
  completed: number;
  failed: number;
  pending_items: Record<string, unknown>[] | null;
  provider_used: string | null;
  is_demo: boolean;
  error: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface DiscoveredEmail {
  id: number;
  job_id: number | null;
  company_id: number | null;
  method: string;
  company_name: string | null;
  domain: string | null;
  email: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  title: string | null;
  department: string | null;
  email_type: string | null;
  source_type: string | null;
  source_title: string | null;
  source_url: string | null;
  snippet: string | null;
  discovery_provider: string;
  confidence: number | null;
  status: string;
  is_demo: boolean;
  verification_id: number | null;
  verification_status: string | null;
  input_row: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
}

export interface EmailVerification {
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
  input_row: Record<string, unknown> | null;
  verified_at: Date;
  created_at: Date;
}
