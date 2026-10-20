/**
 * ResearchEngine: runs the full workflow for one company.
 *
 * It depends only on the SearchProvider interface — never on Google, Bing or any other concrete
 * search engine — and saves everything (results, logs, evidence, review items) as it goes.
 */
import { type Settings, SOURCE_LABELS } from "../config";
import type { Db } from "../db/db";
import { getCompany, insertRow, saveCompany } from "../db/repo";
import { type Company, COMPLETED, CONFLICT, FAILED, type FieldConfidence, LIKELY, NEEDS_REVIEW, NOT_FOUND, RESEARCHING, UNCERTAIN, VERIFIED } from "../models";
import { AllProvidersFailed, type SearchProvider, type SearchResult } from "../providers/base";
import { FAILURE_COOLDOWN } from "../providers/manager";
import { getLogger } from "../utils/logger";
import { personKey, pyRound } from "../utils/normalization";
import { monotonic } from "../utils/rateLimit";
import { emptyIdentification, type Identification, identifyCompany, prepareDocs } from "./companyResearcher";
import { type Candidate, overallConfidence } from "./confidence";
import { findAddress, findBusinessPhone, findCompanyEmail, findPersonEmail, findPersonPhone } from "./contactResearcher";
import { findDuplicate } from "./deduplication";
import { collectPeople, decideDecisionMaker, decideOwner, noOwner, type OwnerDecision, type Person } from "./ownerResearcher";
import type { PageFetcher } from "./pageFetcher";
import * as qb from "./queryBuilder";
import { statusFor } from "./verification";

const log = getLogger("engine");

export const DEMO_NOTE = "DEMO DATA — simulated results, not real research.";

export const STEPS: [string, string][] = [
  ["company", "Company identified"],
  ["website", "Website found"],
  ["owner", "Owner search"],
  ["owner_verify", "Owner verified"],
  ["owner_phone", "Owner phone"],
  ["owner_email", "Owner email"],
  ["company_email", "Company email"],
  ["decision_maker", "Decision maker"],
  ["final", "Final verification"],
];

// Most queries each stage may spend out of the per-company budget.
const STAGE_CAPS: Record<string, number> = { company: 5, owner: 6, owner_phone: 2, owner_email: 2, company_email: 3, decision_maker: 4, dm_contact: 2 };

// A live search API (especially one doing a real-time fetch, like SerpAPI) can time out on an
// occasional query without being broken. One failed query must never throw away a company's
// otherwise-successful research. Only treat the provider as unusable for this company after this
// many DIFFERENT queries fail in a row — and even then only abort the whole company if not a
// single query has succeeded yet; otherwise pause searching until the provider's cooldown has
// passed, so a rough patch in one stage doesn't silently skip every later stage.
const MAX_CONSECUTIVE_QUERY_FAILURES = 3;

/** Raised by the checkpoint when the user presses STOP. */
export class StopResearch extends Error {
  constructor() {
    super("research stopped");
    this.name = "StopResearch";
  }
}

/**
 * The writes for one company, saved together on commit() (like an ORM session): pressing STOP
 * mid-step discards what that step had not saved yet.
 */
class Session {
  private pending: [string, Record<string, unknown>][] = [];

  constructor(
    private db: Db,
    public company: Company,
  ) {}

  add(table: string, row: Record<string, unknown>): void {
    this.pending.push([table, row]);
  }

  async commit(): Promise<void> {
    const rows = this.pending;
    this.pending = [];
    await this.db.transaction(async (tx) => {
      for (const [table, row] of rows) await insertRow(tx, table, row);
      await saveCompany(tx, this.company);
    });
  }

  rollback(): void {
    this.pending = [];
  }
}

interface Context {
  company: Company;
  results: SearchResult[];
  queries: Set<string>;
  providers: Set<string>;
  notes: string[];
  confidences: FieldConfidence;
  needsReview: boolean;
  budgetHit: boolean;
  anySuccess: boolean;
  consecutiveFailures: number;
  providerUnstable: boolean; // currently pausing searches (clears itself after cooldown)
  unstableUntil: number;
  hadOutage: boolean; // sticky, for the final notes — never cleared
}

export interface EngineOptions {
  checkpoint?: () => Promise<void>;
  progress?: (companyId: number, key: string, state: string, detail: string) => void;
  pageFetcher?: PageFetcher | null;
  demoProviders?: string[];
  /** Seconds to pause searching after repeated failures (tests set it to make recovery instant). */
  failureCooldown?: number;
}

export class ResearchEngine {
  private checkpoint: () => Promise<void>;
  private progress: NonNullable<EngineOptions["progress"]>;
  private pageFetcher: PageFetcher | null;
  private demoProviders: Set<string>;
  private failureCooldown: number;

  constructor(
    private db: Db,
    readonly provider: SearchProvider,
    readonly settings: Settings,
    opts: EngineOptions = {},
  ) {
    this.checkpoint = opts.checkpoint ?? (async () => undefined);
    this.progress = opts.progress ?? (() => undefined);
    this.pageFetcher = opts.pageFetcher ?? null;
    this.demoProviders = new Set(opts.demoProviders ?? ["mock"]);
    this.failureCooldown = opts.failureCooldown ?? FAILURE_COOLDOWN;
  }

  // ------------------------------------------------------------------ public
  async researchCompany(companyId: number): Promise<Company> {
    const company = await getCompany(this.db, companyId);
    if (!company) throw new Error(`Company ${companyId} does not exist`);
    const session = new Session(this.db, company);
    await this.reset(session);
    const ctx = newContext(company);
    try {
      await this.run(session, ctx);
    } catch (e) {
      if (e instanceof StopResearch) {
        session.rollback();
        throw e;
      }
      if (e instanceof AllProvidersFailed) {
        await this.fail(session, ctx, `Search providers unavailable: ${e.message}`);
      } else {
        // keep the batch going; record what happened
        log.error({ err: (e as Error).message, companyId }, "research failed");
        session.rollback();
        session.company = (await getCompany(this.db, companyId)) ?? session.company;
        ctx.company = session.company;
        await this.fail(session, ctx, `Unexpected error: ${(e as Error).name}: ${(e as Error).message}`);
      }
    }
    return session.company;
  }

  // --------------------------------------------------------------- lifecycle
  private async reset(session: Session): Promise<void> {
    const company = session.company;
    await this.db.transaction(async (tx) => {
      for (const table of ["cr_search_results", "cr_research_logs", "cr_evidence"]) await tx.execute(`DELETE FROM ${table} WHERE company_id = ?`, [company.id]);
      await tx.execute("DELETE FROM cr_review_queue WHERE company_id = ? AND status = 'OPEN'", [company.id]);
    });
    for (const column of [
      "website", "address", "business_phone", "company_email", "owner_name", "owner_title", "owner_phone", "owner_email", "decision_maker_name",
      "decision_maker_title", "decision_maker_phone", "decision_maker_email", "source", "source_url", "confidence", "verification_status", "notes", "provider_used",
    ] as const) {
      (company as unknown as Record<string, unknown>)[column] = null;
    }
    company.field_confidence = {};
    company.is_demo = false;
    company.research_status = RESEARCHING;
    await session.commit();
  }

  private async fail(session: Session, ctx: Context, message: string): Promise<void> {
    const company = session.company;
    company.research_status = FAILED;
    company.queued = false;
    company.notes = message;
    company.date_researched = new Date();
    this.log(session, "final", null, message, "failed");
    await session.commit();
    this.progress(company.id, "final", "failed", message);
  }

  // ------------------------------------------------------------------ helpers
  private log(session: Session, step: string, query: string | null, result: string, status = "ok"): void {
    session.add("cr_research_logs", { company_id: session.company.id, step, query, result: result.slice(0, 2000), status, timestamp: new Date() });
  }

  private step(ctx: Context, key: string, state: string, detail = ""): void {
    this.progress(ctx.company.id, key, state, detail);
  }

  /** Run one query (if the budget allows). Resolves false when no more queries should run. */
  private async search(session: Session, ctx: Context, step: string, query: string): Promise<boolean> {
    if (ctx.queries.has(query.toLowerCase())) return true;
    if (ctx.providerUnstable) {
      if (monotonic() < ctx.unstableUntil) return false;
      // the cooldown has had time to pass — give it another chance
      ctx.providerUnstable = false;
      ctx.consecutiveFailures = 0;
    }
    if (ctx.queries.size >= this.settings.max_queries_per_company) {
      if (!ctx.budgetHit) {
        ctx.budgetHit = true;
        this.log(session, step, null, `Search limit of ${this.settings.max_queries_per_company} queries reached`, "limit");
      }
      return false;
    }
    await this.checkpoint();
    ctx.queries.add(query.toLowerCase());
    let results: SearchResult[];
    try {
      results = await this.provider.search(query, this.settings.max_results_per_query);
    } catch (e) {
      if (!(e instanceof AllProvidersFailed)) throw e;
      this.log(session, step, query, e.message, "failed");
      await session.commit();
      ctx.consecutiveFailures++;
      if (ctx.consecutiveFailures < MAX_CONSECUTIVE_QUERY_FAILURES) return true; // one query lost to a timeout/outage; try the next variation
      if (!ctx.anySuccess) throw e; // the provider has never once worked for this company: a real failure
      ctx.providerUnstable = true;
      ctx.hadOutage = true;
      ctx.unstableUntil = monotonic() + this.failureCooldown;
      this.log(
        session,
        step,
        null,
        `Search provider failed ${ctx.consecutiveFailures} queries in a row; pausing searches for ${FAILURE_COOLDOWN}s. Already-found results are kept.`,
        "provider_unstable",
      );
      await session.commit();
      return false;
    }
    ctx.consecutiveFailures = 0;
    ctx.anySuccess = true;
    this.storeResults(session, ctx, query, results);
    const providers = [...new Set(results.map((r) => r.source))].sort();
    this.log(session, step, query, `${results.length} results` + (providers.length ? ` via ${providers.join(", ")}` : ""));
    await session.commit();
    return true;
  }

  private storeResults(session: Session, ctx: Context, query: string, results: SearchResult[]): void {
    for (const r of results) {
      r.query = query; // remembered for frequency scoring
      ctx.results.push(r);
      ctx.providers.add(r.source);
      session.add("cr_search_results", {
        company_id: ctx.company.id,
        query,
        title: r.title.slice(0, 500),
        url: r.url.slice(0, 1000),
        snippet: r.snippet,
        display_url: r.displayUrl.slice(0, 500),
        provider: r.source,
        searched_at: new Date(),
      });
    }
  }

  /** Work through query variations until `done()` or the stage/company limit. */
  private async runQueries(session: Session, ctx: Context, step: string, queries: string[], done: () => boolean): Promise<void> {
    let used = 0;
    for (const query of queries) {
      if (done() || used >= STAGE_CAPS[step]) return;
      if (ctx.queries.has(query.toLowerCase())) continue;
      if (!(await this.search(session, ctx, step, query))) return;
      used++;
    }
  }

  private saveEvidence(session: Session, ctx: Context, fieldName: string, candidate: Candidate, selected = true): void {
    for (const item of [...candidate.evidence].sort((a, b) => b.score - a.score).slice(0, 5)) {
      session.add("cr_evidence", {
        company_id: ctx.company.id,
        field: fieldName,
        value: candidate.value,
        detail: item.detail || candidate.detail,
        source_type: item.sourceType,
        source_title: (item.sourceTitle || "").slice(0, 500),
        source_url: (item.sourceUrl || "").slice(0, 1000),
        snippet: item.snippet,
        score: item.score,
        selected,
      });
    }
    if (selected) ctx.confidences[fieldName] = { confidence: pyRound(candidate.confidence), status: candidate.status };
  }

  private review(session: Session, ctx: Context, fieldName: string, issue: string, action: string, candidates: Candidate[]): void {
    ctx.needsReview = true;
    session.add("cr_review_queue", {
      company_id: ctx.company.id,
      field: fieldName,
      issue,
      recommended_action: action,
      conflicting_information: candidates.map((c) => c.toDict()),
      status: "OPEN",
      created_at: new Date(),
    });
    this.log(session, fieldName, null, `Sent to human review: ${issue}`, "review");
  }

  private docs(ctx: Context, ident: Identification) {
    return prepareDocs(ctx.results, ctx.company, ident.domain);
  }

  // ---------------------------------------------------------------- workflow
  private async run(session: Session, ctx: Context): Promise<void> {
    const company = ctx.company;
    const settings = this.settings;
    ctx.confidences.company_name = { confidence: 100, status: "PROVIDED" };

    // 1. Identify the company -------------------------------------------------
    this.step(ctx, "company", "running", "Searching for the company");
    let ident = emptyIdentification();
    const companyDone = () => {
      ident = identifyCompany(company, ctx.results, settings);
      return ident.status === VERIFIED;
    };
    await this.runQueries(session, ctx, "company", qb.buildCompanyQueries(company), companyDone);
    companyDone();

    if (!ident.identified) {
      this.step(ctx, "company", "failed", "Could not identify the company");
      for (const [key] of STEPS.slice(1, -1)) this.step(ctx, key, "skipped");
      ctx.notes.push("Company could not be identified from the search results; nothing was assumed.");
      this.log(session, "company", null, "Company not identified", "not_found");
      ctx.confidences.company = { confidence: 0, status: NOT_FOUND };
      await this.finish(session, ctx, ident);
      return;
    }

    this.step(ctx, "company", "done", `${ident.status} (${pyRound(ident.confidence)}%)`);
    ctx.confidences.company = { confidence: pyRound(ident.confidence), status: ident.status };
    company.source = SOURCE_LABELS[ident.evidence!.sourceType] ?? ident.evidence!.sourceType;
    company.source_url = ident.evidence!.sourceUrl;
    this.log(session, "company", null, `Identified with ${pyRound(ident.confidence)}% confidence via ${company.source}`);

    if (ident.website) {
      company.website = ident.website;
      const site = ident.candidates[0];
      site.status = ident.status;
      this.saveEvidence(session, ctx, "website", site);
      this.step(ctx, "website", "done", ident.website);
      if (ident.ambiguous) {
        this.review(session, ctx, "website", "Multiple possible websites found for this company.", "Choose the correct website or mark it unknown.", ident.candidates.slice(0, 3));
      }
      await this.fetchOfficialPages(session, ctx, ident);
    } else {
      this.step(ctx, "website", "skipped", "No official website found");
      ctx.confidences.website = { confidence: 0, status: NOT_FOUND };
    }
    await session.commit();

    // 2. Owner ----------------------------------------------------------------
    this.step(ctx, "owner", "running", "Searching for the owner");
    let people = new Map<string, Person>();
    let owner: OwnerDecision = noOwner();
    const ownerDone = () => {
      people = collectPeople(this.docs(ctx, ident), company, settings);
      owner = decideOwner(people, settings);
      return owner.status === VERIFIED || owner.status === CONFLICT;
    };
    if (!ownerDone()) {
      await this.runQueries(session, ctx, "owner", qb.buildOwnerQueries(company, ident.website), ownerDone);
      ownerDone();
    }

    if (owner.owner) {
      company.owner_name = owner.owner.value;
      company.owner_title = owner.owner.detail;
      this.saveEvidence(session, ctx, "owner", owner.owner);
      this.step(ctx, "owner", "done", owner.owner.value);
      this.step(ctx, "owner_verify", "done", `${owner.status} (${pyRound(owner.owner.confidence)}%)`);
    } else if (owner.status === CONFLICT) {
      const names = owner.candidates.map((c) => c.value).join(", ");
      for (const candidate of owner.candidates) this.saveEvidence(session, ctx, "owner", candidate, false);
      ctx.confidences.owner = { confidence: 0, status: CONFLICT };
      this.review(session, ctx, "owner", `${owner.candidates.length} possible owners found: ${names}.`, "Choose the correct owner or mark as unknown.", owner.candidates);
      this.step(ctx, "owner", "done", "Conflicting owners");
      this.step(ctx, "owner_verify", "failed", "CONFLICT — human review");
    } else if (owner.status === UNCERTAIN) {
      for (const candidate of owner.candidates) this.saveEvidence(session, ctx, "owner", candidate, false);
      ctx.confidences.owner = { confidence: pyRound(owner.candidates[0].confidence), status: UNCERTAIN };
      this.review(session, ctx, "owner", "A possible owner was found but the evidence is weak.", "Confirm the owner or mark as unknown.", owner.candidates);
      this.step(ctx, "owner", "done", "Weak evidence only");
      this.step(ctx, "owner_verify", "failed", "UNCERTAIN — human review");
    } else {
      ctx.confidences.owner = { confidence: 0, status: NOT_FOUND };
      this.step(ctx, "owner", "done", "Not found");
      this.step(ctx, "owner_verify", "skipped");
    }
    this.log(session, "owner", null, `Owner: ${company.owner_name || owner.status}`);
    await session.commit();

    // 3. Company phone / address (from what has already been collected) --------
    const docs = this.docs(ctx, ident);
    const businessPhone = findBusinessPhone(docs, settings);
    if (businessPhone) {
      company.business_phone = businessPhone.value;
      this.saveEvidence(session, ctx, "business_phone", businessPhone);
    }
    const address = findAddress(docs, settings);
    if (address) {
      company.address = address.value;
      this.saveEvidence(session, ctx, "address", address);
    }

    // 4. Owner phone and email --------------------------------------------------
    if (owner.owner) {
      const [ownerPhone, ownerEmail] = await this.personContacts(session, ctx, ident, owner.owner.value, "owner_phone", "owner_email");
      company.owner_phone = ownerPhone ? ownerPhone.value : null;
      company.owner_email = ownerEmail ? ownerEmail.value : null;
    } else {
      this.step(ctx, "owner_phone", "skipped");
      this.step(ctx, "owner_email", "skipped");
    }

    // 5. Decision maker (always recorded when evidence exists; searched for when no owner)
    let dm: Candidate | null = null;
    const ownerKey = owner.owner ? personKey(owner.owner.value) : null;
    const dmDone = () => {
      const found = collectPeople(this.docs(ctx, ident), company, settings);
      dm = decideDecisionMaker(found, settings, ownerKey);
      return dm !== null && dm.status === VERIFIED;
    };
    if (!owner.owner && owner.status !== CONFLICT) {
      this.step(ctx, "decision_maker", "running", "Searching for a decision maker");
      if (!dmDone()) await this.runQueries(session, ctx, "decision_maker", qb.buildDecisionMakerQueries(company, ident.website), dmDone);
    }
    dmDone();
    const decisionMaker = dm as Candidate | null;
    if (decisionMaker) {
      company.decision_maker_name = decisionMaker.value;
      company.decision_maker_title = decisionMaker.detail;
      this.saveEvidence(session, ctx, "decision_maker", decisionMaker);
      const [dmPhone, dmEmail] = await this.personContacts(session, ctx, ident, decisionMaker.value, "decision_maker_phone", "decision_maker_email", !owner.owner);
      company.decision_maker_phone = dmPhone ? dmPhone.value : null;
      company.decision_maker_email = dmEmail ? dmEmail.value : null;
      this.step(ctx, "decision_maker", "done", `${decisionMaker.value} — ${decisionMaker.detail}`);
    } else {
      this.step(ctx, "decision_maker", owner.owner ? "done" : "failed", owner.owner ? "Not needed (owner found)" : "Not found");
    }
    await session.commit();

    // 6. Company email ----------------------------------------------------------
    this.step(ctx, "company_email", "running", "Looking for a company email");
    const personal = [company.owner_email || "", company.decision_maker_email || ""];
    let companyEmail: Candidate | null = null;
    const emailDone = () => {
      companyEmail = findCompanyEmail(this.docs(ctx, ident), settings, ident.domain, personal);
      return companyEmail !== null && companyEmail.status === VERIFIED;
    };
    if (!emailDone() && !company.owner_email) {
      await this.runQueries(session, ctx, "company_email", qb.buildCompanyEmailQueries(company, ident.website), emailDone);
      emailDone();
    }
    const foundEmail = companyEmail as Candidate | null;
    if (foundEmail) {
      company.company_email = foundEmail.value;
      this.saveEvidence(session, ctx, "company_email", foundEmail);
      this.step(ctx, "company_email", "done", foundEmail.value);
    } else {
      this.step(ctx, "company_email", "failed", "Not found");
    }

    // the phone step above ran before any contact-specific queries; check once more
    if (!company.business_phone) {
      const phone = findBusinessPhone(this.docs(ctx, ident), settings);
      if (phone) {
        company.business_phone = phone.value;
        this.saveEvidence(session, ctx, "business_phone", phone);
      }
    }

    await this.finish(session, ctx, ident);
  }

  /** Find a named person's business phone and email; never guessed. */
  private async personContacts(
    session: Session,
    ctx: Context,
    ident: Identification,
    person: string,
    phoneField: string,
    emailField: string,
    search = true,
  ): Promise<[Candidate | null, Candidate | null]> {
    const company = ctx.company;
    const settings = this.settings;
    let phone: Candidate | null = null;
    let email: Candidate | null = null;
    const isOwner = phoneField === "owner_phone";
    const phoneStep = isOwner ? "owner_phone" : "dm_contact";
    const emailStep = isOwner ? "owner_email" : "dm_contact";

    const phoneDone = () => {
      phone = findPersonPhone(this.docs(ctx, ident), person, settings, company.business_phone);
      return phone !== null && phone.status === VERIFIED;
    };
    const emailDone = () => {
      email = findPersonEmail(this.docs(ctx, ident), person, settings, ident.domain);
      return email !== null && email.status === VERIFIED;
    };

    if (isOwner) this.step(ctx, "owner_phone", "running", `Searching phone for ${person}`);
    if (!phoneDone() && search) {
      await this.runQueries(session, ctx, phoneStep, qb.buildOwnerPhoneQueries(company, person), phoneDone);
      phoneDone();
    }
    const foundPhone = phone as Candidate | null;
    if (foundPhone) this.saveEvidence(session, ctx, phoneField, foundPhone);
    if (isOwner) {
      this.step(ctx, "owner_phone", foundPhone ? "done" : "failed", foundPhone ? foundPhone.value : "Not found");
      this.step(ctx, "owner_email", "running", `Searching email for ${person}`);
    }
    if (!emailDone() && search) {
      await this.runQueries(session, ctx, emailStep, qb.buildOwnerEmailQueries(company, person), emailDone);
      emailDone();
    }
    const foundEmail = email as Candidate | null;
    if (foundEmail) this.saveEvidence(session, ctx, emailField, foundEmail);
    if (isOwner) this.step(ctx, "owner_email", foundEmail ? "done" : "failed", foundEmail ? foundEmail.value : "Not found");
    await session.commit();
    return [foundPhone, foundEmail];
  }

  /** Read the identified official site's own pages (live mode only). */
  private async fetchOfficialPages(session: Session, ctx: Context, ident: Identification): Promise<void> {
    if (!(this.pageFetcher && this.settings.fetch_official_pages)) return;
    if ((ident.status !== VERIFIED && ident.status !== LIKELY) || [...ctx.providers].some((p) => this.demoProviders.has(p))) return;
    await this.checkpoint();
    const pages = await this.pageFetcher.fetchSite(ident.website!);
    this.storeResults(session, ctx, `read official website ${ident.website}`, pages);
    this.log(session, "website", ident.website, `Read ${pages.length} page(s) from the official website`);
  }

  // ------------------------------------------------------------------- finish
  private async finish(session: Session, ctx: Context, ident: Identification): Promise<void> {
    const company = ctx.company;
    const thresholds = this.settings.thresholds;
    this.step(ctx, "final", "running", "Final verification");
    const conf = ctx.confidences;
    const c = (name: string): number | null => conf[name]?.confidence || null;

    for (const name of ["owner", "owner_phone", "owner_email", "decision_maker", "decision_maker_phone", "decision_maker_email", "company_email", "business_phone", "address", "website"]) {
      if (!(name in conf)) conf[name] = { confidence: 0, status: NOT_FOUND };
    }

    // Priority: owner > decision maker > company, for both phone and email.
    const bestPhone = c("owner_phone") || c("decision_maker_phone") || c("business_phone");
    const bestEmail = c("owner_email") || c("decision_maker_email") || c("company_email");
    const person = company.owner_name ? c("owner") : c("decision_maker");
    const overall = ident.identified ? overallConfidence([c("company"), person, bestPhone, bestEmail]) : null;
    company.confidence = overall;

    if (!ident.identified) company.verification_status = NOT_FOUND;
    else if (conf.owner.status === CONFLICT) company.verification_status = CONFLICT;
    else if (ident.status === UNCERTAIN) company.verification_status = UNCERTAIN;
    else company.verification_status = statusFor(overall, thresholds);

    if (ident.identified && ident.status === UNCERTAIN && !ident.ambiguous) {
      this.review(session, ctx, "company", "The company match is uncertain.", "Check the website/source and correct the record if needed.", ident.candidates.slice(0, 3));
    }

    const duplicate = await findDuplicate(this.db, { companyName: "", website: company.website, phone: company.business_phone, address: company.address, excludeId: company.id });
    if (duplicate) {
      const [other, reason] = duplicate;
      ctx.notes.push(`Possible duplicate of #${other.id} ${other.company_name} (${reason}).`);
      this.review(session, ctx, "duplicate", `Possible duplicate of #${other.id} ${other.company_name} (${reason}).`, "Delete one of the records or dismiss if they are different companies.", []);
    }

    if (ident.identified) {
      if (!company.owner_name && conf.owner.status === NOT_FOUND) ctx.notes.push("Owner not found in public business sources.");
      if (!(company.owner_phone || company.decision_maker_phone || company.business_phone)) ctx.notes.push("No verifiable business phone found.");
      if (!(company.owner_email || company.decision_maker_email || company.company_email)) ctx.notes.push("No publicly listed email found.");
    }
    if (ctx.budgetHit) ctx.notes.push("Search limit reached before every query variation was tried.");
    if (ctx.hadOutage) {
      ctx.notes.push("The search provider had repeated timeouts partway through this run and some searches were skipped while it recovered — some fields may be incomplete. Try Research Again.");
    }

    // a "not found" from the simulated web is demo data too
    company.is_demo = [...ctx.providers].some((p) => this.demoProviders.has(p)) || this.provider.isDemo;
    company.provider_used = [...ctx.providers].sort().join(", ") || null;
    if (company.is_demo) {
      ctx.notes.unshift(DEMO_NOTE);
      if (company.source) company.source = `DEMO DATA: ${company.source}`;
    }
    company.notes = ctx.notes.join(" ") || null;
    company.field_confidence = { ...conf };
    company.research_status = ctx.needsReview ? NEEDS_REVIEW : COMPLETED;
    company.queued = false;
    company.date_researched = new Date();
    this.log(session, "final", null, `${company.research_status}: overall confidence ${overall ? pyRound(overall) : 0}%, ${ctx.queries.size} queries used`);
    await session.commit();
    this.step(ctx, "final", "done", company.research_status);
  }
}

function newContext(company: Company): Context {
  return {
    company,
    results: [],
    queries: new Set(),
    providers: new Set(),
    notes: [],
    confidences: {},
    needsReview: false,
    budgetHit: false,
    anySuccess: false,
    consecutiveFailures: 0,
    providerUnstable: false,
    unstableUntil: 0,
    hadOutage: false,
  };
}
