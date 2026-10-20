/** Request bodies (validated like the original Pydantic models) and response shapes. */
import { z } from "zod";
import { SettingsSchema } from "../config";
import type { Company, DiscoveredEmail, EmailVerification, Evidence, ResearchLog, ReviewItem, SearchResultRow } from "../models";

const optStr = z.string().nullable().optional();

export const CompanyCreate = z.object({
  company_name: z.string().min(1).max(300),
  city: optStr,
  state: optStr,
  country: optStr,
  website: optStr,
});

/** Manual corrections. Only the fields that are sent are changed. */
export const COMPANY_EDITABLE = [
  "company_name", "website", "address", "city", "state", "country", "business_phone", "company_email", "owner_name", "owner_title",
  "owner_phone", "owner_email", "decision_maker_name", "decision_maker_title", "decision_maker_phone", "decision_maker_email", "notes",
] as const;
export const CompanyUpdate = z.object(Object.fromEntries(COMPANY_EDITABLE.map((f) => [f, optStr])) as Record<(typeof COMPANY_EDITABLE)[number], typeof optStr>);

export const ReviewResolve = z.object({ action: z.enum(["choose", "unknown", "dismiss"]), candidate_index: z.number().int().nullable().optional() });

export const StartResearch = z.object({ company_ids: z.array(z.number().int()).nullable().optional(), redo: z.boolean().default(false) });

export const SettingsPayload = z.object({
  settings: SettingsSchema,
  providers: z.object({
    default_provider: z.string(),
    secondary_provider: z.string().nullable().optional(),
    enabled: z.record(z.string(), z.boolean()).default({}),
  }),
});

/** Keys are stored only server-side. Empty strings are ignored (the key is left unchanged). */
export const ApiKeys = z.object({ keys: z.record(z.string(), z.string()) });

export const ExportRequest = z.object({ scope: z.enum(["all", "researched", "verified"]).default("all"), include_demo: z.boolean().default(true) });

export const DomainSearchRequest = z.object({ domain: z.string().min(1).max(255), company_name: optStr });
export const FindByCompanyRequest = z.object({ company_name: z.string().min(1).max(300), website: optStr, city: optStr, state: optStr });
export const FindByNameRequest = z.object({ first_name: z.string().min(1).max(100), last_name: z.string().min(1).max(100), company_name: optStr, domain: optStr });
export const VerifyEmailRequest = z.object({ email: z.string().min(3).max(255) });
export const EmailJobStart = z.object({
  kind: z.enum(["domain_search", "find_by_company", "find_by_name", "verify"]),
  items: z.array(z.record(z.string(), z.any())).min(1).max(5000),
});
export const EmailExportRequest = z.object({ scope: z.enum(["all", "verified_only"]).default("all"), include_demo: z.boolean().default(true) });

// ------------------------------------------------------------------ responses
const pick = <T extends object, K extends keyof T>(row: T, keys: readonly K[]) => Object.fromEntries(keys.map((k) => [k, row[k] ?? null])) as Pick<T, K>;

export const companyOut = (c: Company) =>
  pick(c, [
    "id", "company_name", "website", "address", "city", "state", "country", "business_phone", "company_email", "owner_name", "owner_title", "owner_phone",
    "owner_email", "decision_maker_name", "decision_maker_title", "decision_maker_phone", "decision_maker_email", "source", "source_url", "confidence",
    "verification_status", "research_status", "notes", "date_researched", "created_at", "updated_at", "field_confidence", "is_demo", "provider_used",
  ] as const);

export const searchResultOut = (r: SearchResultRow) => pick(r, ["id", "company_id", "query", "title", "url", "snippet", "provider", "searched_at"] as const);
export const logOut = (r: ResearchLog) => pick(r, ["id", "step", "query", "result", "status", "timestamp"] as const);
export const evidenceOut = (e: Evidence) => pick(e, ["id", "field", "value", "detail", "source_type", "source_title", "source_url", "snippet", "score", "selected"] as const);
export const reviewOut = (r: ReviewItem & { company_name?: string | null }) =>
  pick(r, ["id", "company_id", "field", "issue", "conflicting_information", "recommended_action", "status", "resolution", "created_at", "company_name"] as const);

export const discoveredOut = (d: DiscoveredEmail) =>
  pick(d, [
    "id", "job_id", "company_id", "method", "company_name", "domain", "email", "first_name", "last_name", "full_name", "title", "department", "email_type",
    "source_type", "source_title", "source_url", "snippet", "discovery_provider", "confidence", "status", "is_demo", "verification_status", "created_at", "updated_at",
  ] as const);

export const verificationOut = (v: EmailVerification) =>
  pick(v, [
    "id", "job_id", "email", "status", "syntax_check", "domain_check", "mx_check", "mailbox_check", "disposable_status", "role_based_status", "catch_all_status",
    "provider", "is_demo", "provider_raw", "error", "input_row", "verified_at",
  ] as const);
