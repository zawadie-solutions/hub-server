/**
 * Orchestrates Domain Search, Find Email by Company, Find Email by Name and Email Verification.
 *
 * Resolving "company name" -> "official website/domain" reuses the exact same identification
 * logic the main research engine uses, so a company that has already been researched, or that can
 * be found the same way, gets the same answer here.
 */
import type { Settings } from "../config";
import type { Db } from "../db/db";
import { insertRow, updateRow } from "../db/repo";
import { type Company, type DiscoveredEmail, DOMAIN_SEARCH, EMAIL_GENERIC, EMAIL_PERSONAL, type EmailVerification, FIND_BY_COMPANY, FIND_BY_NAME, NEEDS_REVIEW } from "../models";
import { AllProvidersFailed, type SearchProvider, type SearchResult } from "../providers/base";
import { type EmailDiscoveryProvider, type EmailMatch, type EmailVerificationProvider, VERIFICATION_FAILED, verificationResult, type VerificationResult } from "../providers/emailBase";
import { identifyCompany } from "./companyResearcher";
import { GENERIC_LOCALS } from "./extraction";
import * as qb from "./queryBuilder";
import { classifySource, statusFor } from "./verification";

const DOMAIN_SEARCH_LIMIT = 25;

export interface DomainResolution {
  domain: string | null;
  website: string | null;
  confidence: number | null;
  company: Company | null; // the matched company row, if any
}

export function cleanDomain(valueIn: string): string {
  let value = (valueIn || "").trim().toLowerCase();
  for (const prefix of ["https://", "http://"]) if (value.startsWith(prefix)) value = value.slice(prefix.length);
  if (value.startsWith("www.")) value = value.slice(4);
  return value.split("/")[0].trim();
}

// a bare domain: dot-separated labels, no spaces, a plausible TLD-shaped last label
const BARE_DOMAIN_RE = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-)){1,}$/i;

/**
 * True for a URL or a bare domain typed where a company name was expected (e.g. a combined
 * "Company or domain" field). Searching for "a company named https://example.com/" finds nothing.
 */
export function looksLikeDomain(valueIn: string): boolean {
  const value = (valueIn || "").trim();
  if (!value || value.includes(" ")) return false;
  if (/^https?:\/\//i.test(value)) return true;
  const candidate = value.split("/")[0];
  return candidate.includes(".") && BARE_DOMAIN_RE.test(candidate);
}

/**
 * Find a company's domain: an explicit website wins; otherwise reuse an already-researched
 * company; otherwise identify it the same way the main research engine does.
 */
export async function resolveDomain(
  db: Db,
  companyName: string,
  website: string | null | undefined,
  searchProvider: SearchProvider | null | undefined,
  settings: Settings,
  city?: string | null,
  state?: string | null,
): Promise<DomainResolution> {
  if (website) {
    const domain = cleanDomain(website);
    return { domain: domain || null, website: domain ? website : null, confidence: 100.0, company: null };
  }
  if (looksLikeDomain(companyName)) {
    const domain = cleanDomain(companyName);
    return { domain: domain || null, website: domain ? companyName : null, confidence: 100.0, company: null };
  }

  const [existing] = await db.query<Company>("SELECT * FROM cr_companies WHERE LOWER(company_name) = LOWER(?) AND website IS NOT NULL LIMIT 1", [companyName.trim()]);
  if (existing?.website) return { domain: cleanDomain(existing.website), website: existing.website, confidence: existing.confidence, company: existing };

  if (!searchProvider) return { domain: null, website: null, confidence: null, company: existing ?? null };

  const company = { company_name: companyName, city, state };
  const results: SearchResult[] = [];
  for (const query of qb.buildCompanyQueries(company).slice(0, 4)) {
    try {
      for (const item of await searchProvider.search(query, settings.max_results_per_query)) results.push({ ...item, query });
    } catch (e) {
      if (!(e instanceof AllProvidersFailed)) throw e;
    }
  }
  const ident = identifyCompany(company, results, settings);
  if (ident.identified && ident.website) return { domain: cleanDomain(ident.website), website: ident.website, confidence: ident.confidence, company: existing ?? null };
  return { domain: null, website: null, confidence: null, company: existing ?? null };
}

function associationStatus(confidence: number | null, settings: Settings): string {
  if (confidence === null) return NEEDS_REVIEW;
  const status = statusFor(confidence, settings.thresholds);
  return status === "UNCERTAIN" ? NEEDS_REVIEW : status;
}

const getDiscovered = async (db: Db, id: number) => (await db.query<DiscoveredEmail>("SELECT * FROM cr_discovered_emails WHERE id = ?", [id]))[0];

/** Inserts a new discovered-email row, or updates `existing` in place; returns the saved row. */
async function upsertDiscovered(db: Db, existing: DiscoveredEmail | undefined, fields: Partial<DiscoveredEmail>): Promise<DiscoveredEmail> {
  const now = new Date();
  if (existing) {
    await updateRow(db, "cr_discovered_emails", existing.id, { ...fields, updated_at: now });
    return getDiscovered(db, existing.id);
  }
  const id = await insertRow(db, "cr_discovered_emails", { status: "NOT_FOUND", is_demo: false, ...fields, created_at: now, updated_at: now });
  return getDiscovered(db, id);
}

const hasKeys = (value: Record<string, unknown> | null | undefined) => Boolean(value && Object.keys(value).length);

interface SaveContext {
  method: string;
  discoveryProvider: string;
  isDemo: boolean;
  settings: Settings;
  jobId?: number | null;
  company?: Company | null;
  companyName?: string | null;
  domain?: string | null;
  inputRow?: Record<string, unknown> | null;
}

async function saveMatch(db: Db, match: EmailMatch, s: SaveContext): Promise<DiscoveredEmail> {
  const email = (match.email || "").trim().toLowerCase();
  const confidence = match.providerConfidence ?? (s.discoveryProvider === "hunter" ? 60.0 : 55.0);
  const status = associationStatus(confidence, s.settings);
  const emailType = match.emailType || (GENERIC_LOCALS.has(email.split("@")[0]) ? EMAIL_GENERIC : EMAIL_PERSONAL);
  const sourceType = match.sourceUrl ? classifySource(match.sourceUrl, s.domain) : null;
  const companyId = s.company ? s.company.id : null;
  const domain = s.domain ?? null;

  const [existing] = await db.query<DiscoveredEmail>(
    "SELECT * FROM cr_discovered_emails WHERE email = ? AND method = ? AND company_id <=> ? AND domain <=> ? ORDER BY id LIMIT 1",
    [email, s.method, companyId, domain],
  );
  return upsertDiscovered(db, existing, {
    method: s.method,
    email,
    company_id: companyId,
    company_name: (s.company ? s.company.company_name : s.companyName) || existing?.company_name || null,
    domain: domain || existing?.domain || null,
    first_name: match.firstName || existing?.first_name || null,
    last_name: match.lastName || existing?.last_name || null,
    full_name: match.fullName || existing?.full_name || null,
    title: match.title || existing?.title || null,
    department: match.department || existing?.department || null,
    email_type: emailType,
    source_type: sourceType || existing?.source_type || null,
    source_title: match.sourceTitle || existing?.source_title || null,
    source_url: match.sourceUrl || existing?.source_url || null,
    discovery_provider: s.discoveryProvider,
    confidence,
    status,
    is_demo: s.isDemo,
    job_id: s.jobId || existing?.job_id || null,
    input_row: hasKeys(s.inputRow) ? s.inputRow! : (existing?.input_row ?? null),
  });
}

export interface RunOptions {
  companyName?: string | null;
  jobId?: number | null;
  inputRow?: Record<string, unknown> | null;
}

export async function runDomainSearch(db: Db, domainIn: string, discovery: EmailDiscoveryProvider, settings: Settings, opts: RunOptions = {}): Promise<DiscoveredEmail[]> {
  const domain = cleanDomain(domainIn);
  if (!domain) return [];
  const matches = await discovery.searchDomain(domain, DOMAIN_SEARCH_LIMIT);
  const rows: DiscoveredEmail[] = [];
  for (const m of matches) {
    if (!m.email) continue;
    rows.push(await saveMatch(db, m, { method: DOMAIN_SEARCH, discoveryProvider: discovery.name, isDemo: discovery.isDemo, settings, jobId: opts.jobId, companyName: opts.companyName, domain, inputRow: opts.inputRow }));
  }
  return rows;
}

/** A 'nothing found' marker — updated in place on repeated runs instead of piling up. */
export async function savePlaceholder(
  db: Db,
  p: {
    method: string;
    companyName: string | null | undefined;
    domain: string | null | undefined;
    status: string;
    discoveryProvider: string;
    isDemo: boolean;
    jobId?: number | null;
    inputRow?: Record<string, unknown> | null;
    company?: Company | null;
    firstName?: string | null;
    lastName?: string | null;
  },
): Promise<DiscoveredEmail> {
  const companyId = p.company ? p.company.id : null;
  const [existing] = await db.query<DiscoveredEmail>(
    "SELECT * FROM cr_discovered_emails WHERE email = '' AND method = ? AND company_id <=> ? AND company_name <=> ? AND first_name <=> ? AND last_name <=> ? ORDER BY id LIMIT 1",
    [p.method, companyId, p.companyName ?? null, p.firstName ?? null, p.lastName ?? null],
  );
  return upsertDiscovered(db, existing, {
    method: p.method,
    email: "",
    company_name: p.companyName ?? null,
    domain: p.domain ?? null,
    company_id: companyId,
    first_name: p.firstName ?? null,
    last_name: p.lastName ?? null,
    discovery_provider: p.discoveryProvider,
    is_demo: p.isDemo,
    status: p.status,
    job_id: p.jobId || existing?.job_id || null,
    input_row: hasKeys(p.inputRow) ? p.inputRow! : (existing?.input_row ?? null),
  });
}

export async function runFindByCompany(
  db: Db,
  companyName: string,
  discovery: EmailDiscoveryProvider,
  settings: Settings,
  opts: RunOptions & { website?: string | null; searchProvider?: SearchProvider | null; city?: string | null; state?: string | null } = {},
): Promise<DiscoveredEmail[]> {
  const resolution = await resolveDomain(db, companyName, opts.website, opts.searchProvider, settings, opts.city, opts.state);
  if (!resolution.domain) {
    return [
      await savePlaceholder(db, {
        method: FIND_BY_COMPANY,
        companyName,
        domain: null,
        status: NEEDS_REVIEW,
        discoveryProvider: discovery.name,
        isDemo: discovery.isDemo,
        jobId: opts.jobId,
        inputRow: opts.inputRow,
        company: resolution.company,
      }),
    ];
  }
  const matches = await discovery.findByCompany(companyName, resolution.domain);
  const rows: DiscoveredEmail[] = [];
  for (const m of matches) {
    if (!m.email) continue;
    rows.push(
      await saveMatch(db, m, {
        method: FIND_BY_COMPANY,
        discoveryProvider: discovery.name,
        isDemo: discovery.isDemo,
        settings,
        jobId: opts.jobId,
        company: resolution.company,
        companyName,
        domain: resolution.domain,
        inputRow: opts.inputRow,
      }),
    );
  }
  return rows;
}

export async function runFindByName(
  db: Db,
  firstName: string,
  lastName: string,
  discovery: EmailDiscoveryProvider,
  settings: Settings,
  opts: RunOptions & { domain?: string | null; searchProvider?: SearchProvider | null } = {},
): Promise<DiscoveredEmail[]> {
  let resolvedDomain = opts.domain ? cleanDomain(opts.domain) : null;
  let companyRow: Company | null = null;
  if (!resolvedDomain && opts.companyName) {
    const resolution = await resolveDomain(db, opts.companyName, null, opts.searchProvider, settings);
    resolvedDomain = resolution.domain;
    companyRow = resolution.company;
  }

  // If what was typed as the "company name" was actually a URL/domain, it already did its job
  // resolving the domain above — feeding it back in as a company name would build queries that
  // quote a URL next to the person's name, which matches nothing useful.
  const nameLabel = looksLikeDomain(opts.companyName || "") ? null : (opts.companyName ?? null);

  const matches = await discovery.findByName(firstName, lastName, resolvedDomain, nameLabel);
  for (const match of matches) {
    // a provider that only echoes the email must not lose who we searched for
    match.firstName = match.firstName || firstName;
    match.lastName = match.lastName || lastName;
    match.fullName = match.fullName || `${firstName} ${lastName}`.trim();
  }
  if (!matches.length) {
    return [
      await savePlaceholder(db, {
        method: FIND_BY_NAME,
        companyName: nameLabel,
        domain: resolvedDomain,
        status: "NOT_FOUND",
        discoveryProvider: discovery.name,
        isDemo: discovery.isDemo,
        jobId: opts.jobId,
        inputRow: opts.inputRow,
        company: companyRow,
        firstName,
        lastName,
      }),
    ];
  }
  const rows: DiscoveredEmail[] = [];
  for (const m of matches) {
    rows.push(
      await saveMatch(db, m, {
        method: FIND_BY_NAME,
        discoveryProvider: discovery.name,
        isDemo: discovery.isDemo,
        settings,
        jobId: opts.jobId,
        company: companyRow,
        companyName: nameLabel,
        domain: resolvedDomain,
        inputRow: opts.inputRow,
      }),
    );
  }
  return rows;
}

// ------------------------------------------------------------------------- verification
/**
 * Case-insensitive de-duplication that keeps a record of every input row per address, so
 * results can still be matched back to every row that asked for them.
 */
export function dedupeEmails(items: Record<string, any>[]): [Record<string, any>[], Map<string, Record<string, any>[]>] {
  const unique: Record<string, any>[] = [];
  const seen = new Set<string>();
  const rowsByEmail = new Map<string, Record<string, any>[]>();
  for (const item of items) {
    const email = String(item.email || "").trim().toLowerCase();
    if (!email) continue;
    if (!rowsByEmail.has(email)) rowsByEmail.set(email, []);
    rowsByEmail.get(email)!.push(item);
    if (!seen.has(email)) {
      seen.add(email);
      unique.push(item);
    }
  }
  return [unique, rowsByEmail];
}

function jsonSafe(raw: Record<string, unknown>): Record<string, unknown> {
  try {
    JSON.stringify(raw);
    return raw;
  } catch {
    return { note: "provider response was not JSON-serialisable" };
  }
}

/** Runs a provider, saves the result and syncs any discovered rows for the same address. */
export async function verifyOne(
  db: Db,
  email: string,
  provider: Pick<EmailVerificationProvider, "name" | "isDemo" | "verify">,
  opts: { jobId?: number | null; inputRow?: Record<string, unknown> | null } = {},
): Promise<EmailVerification> {
  const emailClean = (email || "").trim().toLowerCase();
  let result: VerificationResult;
  try {
    result = await provider.verify(emailClean);
  } catch (e) {
    // a provider failure is a result in its own right, never a 500
    result = verificationResult({ status: VERIFICATION_FAILED, provider: provider.name, error: `${(e as Error).name}: ${(e as Error).message}` });
  }
  const now = new Date();
  const id = await insertRow(db, "cr_email_verifications", {
    job_id: opts.jobId ?? null,
    email: emailClean,
    status: result.status,
    syntax_check: result.syntax_check,
    domain_check: result.domain_check,
    mx_check: result.mx_check,
    mailbox_check: result.mailbox_check,
    disposable_status: result.disposable_status,
    role_based_status: result.role_based_status,
    catch_all_status: result.catch_all_status,
    provider: result.provider || provider.name,
    is_demo: provider.isDemo,
    provider_raw: jsonSafe(result.raw),
    error: result.error || null,
    input_row: opts.inputRow ?? null,
    verified_at: now,
    created_at: now,
  });
  await db.execute("UPDATE cr_discovered_emails SET verification_id = ?, verification_status = ?, updated_at = ? WHERE email = ?", [id, result.status, now, emailClean]);
  return (await db.query<EmailVerification>("SELECT * FROM cr_email_verifications WHERE id = ?", [id]))[0];
}
