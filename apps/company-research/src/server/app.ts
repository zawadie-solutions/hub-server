/** The Company Research web app: REST API (same routes and JSON as the original FastAPI app) plus the built UI. */
import { existsSync, readdirSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";
import express from "express";
import multer from "multer";
import { type ConfigStore, exportDir, ROOT, type Settings, SOURCE_LABELS } from "../config";
import type { Db } from "../db/db";
import { getCompany, insertRow, saveCompany } from "../db/repo";
import { exportCompanies, exportDiscoveredEmails, exportEmailVerifications } from "../exporter";
import { addCompany, importFile, parseTable } from "../importer";
import { type Company, COMPLETED, CONFLICT, type DiscoveredEmail, DOMAIN_SEARCH, type EmailVerification, type Evidence, FAILED, FIND_BY_COMPANY, FIND_BY_NAME, NEEDS_REVIEW, NOT_FOUND, PENDING, RESEARCHING, type ResearchLog, type ReviewItem, type SearchResultRow, VERIFY } from "../models";
import { buildDiscoveryProvider, buildVerificationProvider, allowedKeyNames, discoveryProviderStatus, verificationProviderStatus } from "../providers/emailRegistry";
import { SearchManager } from "../providers/manager";
import { buildChain, getProvider, PROVIDER_CLASSES, providerStatus } from "../providers/registry";
import { EmailJobManager, type Item } from "../research/emailJobManager";
import { dedupeEmails, resolveDomain, runDomainSearch, runFindByCompany, runFindByName, savePlaceholder, verifyOne } from "../research/emailResearcher";
import { JobConflictError, JobInputError } from "../research/jobControl";
import { JobManager } from "../research/jobManager";
import { statusFor } from "../research/verification";
import { RateLimiter } from "../utils/rateLimit";
import { HttpError, intParam, intQuery, parseBody, route, strQuery } from "./http";
import * as s from "./schemas";

export interface AppOptions {
  db: Db;
  config: ConfigStore;
  /** Who the hub says is signed in (shown in the UI, which then skips its own sign-in screen). */
  userOf: (req: express.Request) => string | null;
}

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const EXPORT_NAME = /^company_research_[\w-]+\.xlsx$/;
const EMAIL_EXPORT_NAME = /^email_(discovery|verification)_[\w-]+\.xlsx$/;
const EMAIL_EXPORT_PREFIX: Record<string, string> = { discovered: "email_discovery", verifications: "email_verification" };

const stamp = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

function listFiles(prefix: string) {
  return readdirSync(exportDir())
    .filter((name) => name.startsWith(prefix) && name.endsWith(".xlsx"))
    .map((name) => ({ name, stat: statSync(path.join(exportDir(), name)) }))
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)
    .map(({ name, stat }) => ({ filename: name, size: stat.size, created_at: stat.mtime.toISOString() }));
}

/** Wires the background jobs, then returns the Express app (mounted by the hub at /company-research). */
export async function createApp({ db, config, userOf }: AppOptions) {
  const jobs = new JobManager(db, config);
  const emailJobs = new EmailJobManager(db);

  /** A fresh SearchManager + Settings, built the way company research builds one, reused as the
   *  live web-search fallback for email discovery when Hunter.io is not configured. */
  async function emailSearchContext(): Promise<[Settings, SearchManager]> {
    const settings = await config.loadSettings();
    const [chain, demo] = buildChain(await config.loadProvidersConfig());
    return [settings, new SearchManager(chain, { rateLimiter: new RateLimiter(demo ? 0 : settings.request_delay_seconds), maxRetries: settings.max_retries, maxConcurrent: 1 })];
  }

  const str = (item: Item, key: string) => (item[key] == null ? "" : String(item[key]));

  emailJobs.register(DOMAIN_SEARCH, async (jobId) => {
    const [settings, searchProvider] = await emailSearchContext();
    const [discovery, isDemo] = buildDiscoveryProvider(settings, searchProvider);
    const processOne = async (item: Item) => {
      let domain: string | null = str(item, "domain") || null;
      const companyName = str(item, "company_name") || null;
      if (!domain && companyName) domain = (await resolveDomain(db, companyName, null, searchProvider, settings)).domain;
      if (!domain) {
        await savePlaceholder(db, { method: DOMAIN_SEARCH, companyName, domain: null, status: NEEDS_REVIEW, discoveryProvider: discovery.name, isDemo, jobId, inputRow: item });
        return;
      }
      await runDomainSearch(db, domain, discovery, settings, { companyName, jobId, inputRow: item });
    };
    return [processOne, discovery.label, isDemo];
  });
  emailJobs.register(FIND_BY_COMPANY, async (jobId) => {
    const [settings, searchProvider] = await emailSearchContext();
    const [discovery, isDemo] = buildDiscoveryProvider(settings, searchProvider);
    const processOne = async (item: Item) => {
      await runFindByCompany(db, str(item, "company_name"), discovery, settings, {
        website: str(item, "website") || null,
        searchProvider,
        city: item.city ?? null,
        state: item.state ?? null,
        jobId,
        inputRow: item,
      });
    };
    return [processOne, discovery.label, isDemo];
  });
  emailJobs.register(FIND_BY_NAME, async (jobId) => {
    const [settings, searchProvider] = await emailSearchContext();
    const [discovery, isDemo] = buildDiscoveryProvider(settings, searchProvider);
    const processOne = async (item: Item) => {
      await runFindByName(db, str(item, "first_name"), str(item, "last_name"), discovery, settings, {
        companyName: str(item, "company_name") || null,
        domain: str(item, "domain") || null,
        searchProvider,
        jobId,
        inputRow: item,
      });
    };
    return [processOne, discovery.label, isDemo];
  });
  emailJobs.register(VERIFY, async (jobId) => {
    const [provider, isDemo] = buildVerificationProvider();
    const processOne = async (item: Item) => {
      await verifyOne(db, str(item, "email"), provider, { jobId, inputRow: item });
    };
    return [processOne, provider.label, isDemo];
  });

  await config.loadKeys();
  await jobs.recover();
  await emailJobs.recover();

  const app = express();
  const api = express.Router();
  api.use(express.json({ limit: "20mb" }));
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } }).single("file");
  const fileOf = (req: express.Request) => {
    if (!req.file) throw new HttpError(422, [{ loc: ["body", "file"], msg: "Field required", type: "missing" }]);
    return req.file;
  };

  async function companyOr404(id: number): Promise<Company> {
    const company = await getCompany(db, id);
    if (!company) throw new HttpError(404, "Company not found");
    return company;
  }

  const jobCall = async <T>(fn: () => Promise<T>) => {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof JobInputError) throw new HttpError(400, e.message);
      if (e instanceof JobConflictError) throw new HttpError(409, e.message);
      throw e;
    }
  };

  // ------------------------------------------------------------------ dashboard
  api.get("/health", route(() => ({ status: "ok" })));
  api.get("/session", route((req) => ({ hub_user: userOf(req) })));

  api.get(
    "/dashboard",
    route(async () => {
      const count = async (where = "1=1", params: unknown[] = []) => Number((await db.query<{ n: number }>(`SELECT COUNT(*) AS n FROM cr_companies WHERE ${where}`, params))[0].n);
      const researched = "research_status IN ('COMPLETED', 'NEEDS_REVIEW')";
      const hasContact = "(owner_phone IS NOT NULL OR owner_email IS NOT NULL OR decision_maker_phone IS NOT NULL OR decision_maker_email IS NOT NULL OR business_phone IS NOT NULL OR company_email IS NOT NULL)";
      const [, demoMode] = buildChain(await config.loadProvidersConfig());
      return {
        total: await count(),
        completed: await count("research_status = ?", [COMPLETED]),
        researching: await count("research_status = ?", [RESEARCHING]),
        pending: await count("research_status = ?", [PENDING]),
        owner_found: await count(`${researched} AND owner_name IS NOT NULL`),
        owner_not_found: await count(`${researched} AND owner_name IS NULL`),
        contact_found: await count(`${researched} AND ${hasContact}`),
        needs_review: await count("research_status = ?", [NEEDS_REVIEW]),
        failed: await count("research_status = ?", [FAILED]),
        demo_records: await count("is_demo = 1"),
        open_reviews: Number((await db.query<{ n: number }>("SELECT COUNT(*) AS n FROM cr_review_queue WHERE status = 'OPEN'"))[0].n),
        demo_mode: demoMode,
      };
    }),
  );

  // ------------------------------------------------------------------ companies
  api.get(
    "/companies",
    route(async (req) => {
      const where: string[] = [];
      const params: unknown[] = [];
      const search = strQuery(req, "search").trim();
      const status = strQuery(req, "status");
      if (search) {
        where.push("(company_name LIKE ? OR owner_name LIKE ? OR city LIKE ?)");
        const like = `%${search}%`;
        params.push(like, like, like);
      }
      if (status) {
        where.push("(research_status = ? OR verification_status = ?)");
        params.push(status, status);
      }
      const rows = await db.query<Company>(`SELECT * FROM cr_companies ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY id DESC`, params);
      return rows.map(s.companyOut);
    }),
  );

  api.post(
    "/companies",
    route(async (req) => {
      const payload = parseBody(s.CompanyCreate, req.body);
      const record = Object.fromEntries(Object.entries(payload).map(([k, v]) => [k, (v ?? "").trim()]));
      const [company, existing, reason] = await addCompany(db, record);
      if (existing) return { created: false, duplicate_of: existing.id, reason, company: s.companyOut(existing) };
      return { created: true, company: s.companyOut(company!) };
    }),
  );

  api.get(
    "/companies/:id",
    route(async (req) => {
      const id = intParam(req, "id");
      const company = await companyOr404(id);
      return {
        company: s.companyOut(company),
        evidence: (await db.query<Evidence>("SELECT * FROM cr_evidence WHERE company_id = ? ORDER BY score DESC", [id])).map(s.evidenceOut),
        logs: (await db.query<ResearchLog>("SELECT * FROM cr_research_logs WHERE company_id = ? ORDER BY id", [id])).map(s.logOut),
        search_results: (await db.query<SearchResultRow>("SELECT * FROM cr_search_results WHERE company_id = ? ORDER BY id", [id])).map(s.searchResultOut),
        reviews: (await db.query<ReviewItem>("SELECT * FROM cr_review_queue WHERE company_id = ? ORDER BY id", [id])).map((r) => s.reviewOut(r)),
        source_labels: SOURCE_LABELS,
      };
    }),
  );

  api.put(
    "/companies/:id",
    route(async (req) => {
      const company = await companyOr404(intParam(req, "id"));
      const payload = parseBody(s.CompanyUpdate, req.body);
      // only the fields that were actually sent
      const changes = Object.fromEntries(Object.entries(payload).filter(([k]) => k in (req.body ?? {}))) as Record<string, string | null>;
      if ("company_name" in changes && !(changes.company_name ?? "").trim()) throw new HttpError(422, "Company name cannot be empty");
      const confidence = { ...(company.field_confidence ?? {}) };
      const record = company as unknown as Record<string, unknown>;
      for (const [field, raw] of Object.entries(changes)) {
        const value = (raw ?? "").trim() || null;
        if (record[field] !== value) {
          record[field] = value;
          const key = field === "owner_name" || field === "decision_maker_name" ? field.replace(/_name$/, "") : field;
          if (key in confidence) confidence[key] = { confidence: value ? 100 : 0, status: value ? "MANUAL" : NOT_FOUND };
        }
      }
      company.field_confidence = confidence;
      const names = Object.keys(changes).sort();
      await db.transaction(async (tx) => {
        await saveCompany(tx, company);
        await insertRow(tx, "cr_research_logs", { company_id: company.id, step: "manual_edit", status: "ok", result: names.length ? "Edited by user: " + names.join(", ") : "No changes", timestamp: new Date() });
      });
      return s.companyOut(company);
    }),
  );

  api.delete(
    "/companies/:id",
    route(async (req) => {
      const id = intParam(req, "id");
      const company = await companyOr404(id);
      if (company.research_status === RESEARCHING) throw new HttpError(409, "This company is being researched right now");
      await db.execute("DELETE FROM cr_companies WHERE id = ?", [id]);
      return { deleted: id };
    }),
  );

  api.post(
    "/import",
    upload,
    route(async (req) => {
      const file = fileOf(req);
      try {
        return await importFile(db, file.originalname || "", file.buffer);
      } catch (e) {
        if (e instanceof HttpError) throw e;
        const message = (e as Error).message;
        throw new HttpError(400, message.startsWith("Unsupported file type") ? message : `Could not read the file: ${message}`);
      }
    }),
  );

  api.get(
    "/sample-input",
    route((_req, res) => {
      const file = path.join(ROOT, "examples", "companies_example.xlsx");
      if (!existsSync(file)) throw new HttpError(404, "Example file is missing");
      res.download(file, path.basename(file));
    }),
  );

  // ------------------------------------------------------------------- research
  api.get("/research/status", route(() => jobs.status()));
  api.post(
    "/research/start",
    route(async (req) => {
      const payload = parseBody(s.StartResearch, req.body);
      return jobCall(() => jobs.start(payload.company_ids, payload.redo));
    }),
  );
  api.post("/research/pause", route(() => jobs.pause()));
  api.post("/research/resume", route(() => jobs.resume()));
  api.post("/research/stop", route(() => jobs.stop()));

  // --------------------------------------------------------------- review queue
  api.get(
    "/review",
    route(async (req) => {
      const status = strQuery(req, "status", "OPEN");
      const rows = await db.query<ReviewItem & { company_name: string }>(
        `SELECT r.*, c.company_name FROM cr_review_queue r JOIN cr_companies c ON c.id = r.company_id ${status !== "ALL" ? "WHERE r.status = ?" : ""} ORDER BY r.id DESC`,
        status !== "ALL" ? [status] : [],
      );
      return rows.map(s.reviewOut);
    }),
  );

  api.post(
    "/review/:id/resolve",
    route(async (req) => {
      const payload = parseBody(s.ReviewResolve, req.body);
      const [item] = await db.query<ReviewItem>("SELECT * FROM cr_review_queue WHERE id = ?", [intParam(req, "id")]);
      if (!item) throw new HttpError(404, "Review item not found");
      if (item.status !== "OPEN") throw new HttpError(409, "This review item is already resolved");
      const company = await companyOr404(item.company_id);
      const confidence = { ...(company.field_confidence ?? {}) };
      const candidates = (item.conflicting_information ?? []) as { value: string; detail?: string; confidence?: number }[];
      let resolution: string;
      const evidenceUpdates: [number, boolean][] = [];

      if (payload.action === "choose") {
        const index = payload.candidate_index;
        if (index === null || index === undefined || index < 0 || index >= candidates.length) throw new HttpError(422, "Pick one of the listed candidates");
        const chosen = candidates[index];
        if (item.field === "owner") {
          company.owner_name = chosen.value;
          company.owner_title = chosen.detail || null;
          confidence.owner = { confidence: chosen.confidence ?? 0, status: "CONFIRMED" };
          const evidence = await db.query<Evidence>("SELECT * FROM cr_evidence WHERE company_id = ? AND field = 'owner'", [company.id]);
          for (const e of evidence) evidenceUpdates.push([e.id, e.value === chosen.value]);
        } else if (item.field === "website" || item.field === "company") {
          company.website = chosen.value;
          confidence.website = { confidence: chosen.confidence ?? 0, status: "CONFIRMED" };
        }
        resolution = `Chose ${chosen.value}`;
      } else if (payload.action === "unknown") {
        if (item.field === "owner") {
          company.owner_name = company.owner_title = null;
          company.owner_phone = company.owner_email = null;
          confidence.owner = { confidence: 0, status: NOT_FOUND };
        } else if (item.field === "website") {
          company.website = null;
          confidence.website = { confidence: 0, status: NOT_FOUND };
        }
        resolution = "Marked unknown";
      } else {
        resolution = "Dismissed";
      }

      company.field_confidence = confidence;
      const stillOpen = Number(
        (await db.query<{ n: number }>("SELECT COUNT(*) AS n FROM cr_review_queue WHERE company_id = ? AND status = 'OPEN' AND id <> ?", [company.id, item.id]))[0].n,
      );
      if (!stillOpen && company.research_status === NEEDS_REVIEW) company.research_status = COMPLETED;
      if (item.field === "owner" && company.verification_status === CONFLICT) company.verification_status = statusFor(company.confidence, (await config.loadSettings()).thresholds);

      await db.transaction(async (tx) => {
        for (const [id, selected] of evidenceUpdates) await tx.execute("UPDATE cr_evidence SET selected = ? WHERE id = ?", [selected, id]);
        await tx.execute("UPDATE cr_review_queue SET status = 'RESOLVED', resolution = ? WHERE id = ?", [resolution, item.id]);
        await saveCompany(tx, company);
        await insertRow(tx, "cr_research_logs", { company_id: company.id, step: "review", status: "ok", result: `Review resolved by user: ${item.issue} -> ${resolution}`, timestamp: new Date() });
      });
      return s.reviewOut({ ...item, status: "RESOLVED", resolution, company_name: company.company_name });
    }),
  );

  // ------------------------------------------------------------- search results
  api.get(
    "/search-results",
    route(async (req) => {
      const companyId = intQuery(req, "company_id", null);
      const q = strQuery(req, "q").trim();
      const limit = Math.max(1, Math.min(intQuery(req, "limit", 200)!, 1000));
      const where: string[] = [];
      const params: unknown[] = [];
      if (companyId) {
        where.push("r.company_id = ?");
        params.push(companyId);
      }
      if (q) {
        where.push("(r.query LIKE ? OR r.title LIKE ? OR r.url LIKE ? OR c.company_name LIKE ?)");
        params.push(...Array(4).fill(`%${q}%`));
      }
      const rows = await db.query<SearchResultRow & { company_name: string }>(
        `SELECT r.*, c.company_name FROM cr_search_results r JOIN cr_companies c ON c.id = r.company_id ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY r.id DESC LIMIT ?`,
        [...params, limit],
      );
      return rows.map((r) => ({ ...s.searchResultOut(r), company_name: r.company_name }));
    }),
  );

  // --------------------------------------------------------------------- export
  api.get("/exports", route(() => listFiles("company_research_")));

  api.post(
    "/exports",
    route(async (req) => {
      const payload = parseBody(s.ExportRequest, req.body);
      const where: string[] = [];
      if (payload.scope === "researched") where.push("research_status IN ('COMPLETED', 'NEEDS_REVIEW')");
      else if (payload.scope === "verified") where.push("research_status = 'COMPLETED' AND verification_status IN ('VERIFIED', 'LIKELY')");
      if (!payload.include_demo) where.push("is_demo = 0");
      const companies = await db.query<Company>(`SELECT * FROM cr_companies ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY company_name`);
      if (!companies.length) throw new HttpError(400, "There are no companies matching this export.");
      const filename = `company_research_${stamp()}.xlsx`;
      await exportCompanies(companies, path.join(exportDir(), filename));
      return { filename, rows: companies.length };
    }),
  );

  const exportFile = (filename: string, pattern: RegExp) => {
    const file = path.join(exportDir(), filename);
    if (!pattern.test(filename) || !existsSync(file)) throw new HttpError(404, "Export not found");
    return file;
  };

  api.get(
    "/exports/:filename",
    route((req, res) => {
      res.type(XLSX_TYPE).download(exportFile(req.params.filename, EXPORT_NAME), req.params.filename);
    }),
  );
  api.delete(
    "/exports/:filename",
    route((req) => {
      unlinkSync(exportFile(req.params.filename, EXPORT_NAME));
      return { deleted: req.params.filename };
    }),
  );

  // ------------------------------------------------------------------- settings
  async function settingsResponse() {
    const cfg = await config.loadProvidersConfig();
    const [chain, demoMode] = buildChain(cfg);
    return {
      settings: await config.loadSettings(),
      default_provider: cfg.default_provider,
      secondary_provider: cfg.secondary_provider,
      providers: providerStatus(cfg),
      active_chain: chain.map((p) => p.name),
      demo_mode: demoMode,
      source_labels: SOURCE_LABELS,
    };
  }

  const keyNames = () => allowedKeyNames(Object.keys(PROVIDER_CLASSES).map(getProvider));

  api.get("/settings", route(() => settingsResponse()));

  api.put(
    "/settings",
    route(async (req) => {
      const payload = parseBody(s.SettingsPayload, req.body);
      const selection = payload.providers;
      for (const name of [selection.default_provider, selection.secondary_provider]) if (name && !(name in PROVIDER_CLASSES)) throw new HttpError(422, `Unknown provider: ${name}`);
      const t = payload.settings.thresholds;
      if (!(t.verified > t.likely && t.likely > t.uncertain)) throw new HttpError(422, "Thresholds must satisfy verified > likely > uncertain");
      await config.saveSettings(payload.settings);
      const cfg = await config.loadProvidersConfig();
      cfg.default_provider = selection.default_provider;
      cfg.secondary_provider = selection.secondary_provider || null;
      for (const name of Object.keys(PROVIDER_CLASSES)) {
        const enabled = selection.enabled[name] ?? cfg.providers[name]?.enabled ?? false;
        cfg.providers[name] = { enabled: enabled || name === "mock" };
      }
      await config.saveProvidersConfig(cfg);
      return settingsResponse();
    }),
  );

  api.put(
    "/settings/keys",
    route(async (req) => {
      const payload = parseBody(s.ApiKeys, req.body);
      const allowed = keyNames();
      for (const [name, raw] of Object.entries(payload.keys)) {
        if (!allowed.has(name)) throw new HttpError(422, `Unknown setting: ${name}`);
        const value = raw.trim();
        if (value) {
          if (/\s/.test(value)) throw new HttpError(422, `${name} must not contain spaces`);
          await config.saveKey(name, value);
        }
      }
      return settingsResponse();
    }),
  );

  api.delete(
    "/settings/keys/:name",
    route(async (req) => {
      if (!keyNames().has(req.params.name)) throw new HttpError(422, `Unknown setting: ${req.params.name}`);
      await config.saveKey(req.params.name, "");
      return settingsResponse();
    }),
  );

  // ============================================================== email research
  api.get(
    "/email/providers",
    route(async () => {
      const [settings, searchProvider] = await emailSearchContext();
      const [discovery, discoveryDemo] = buildDiscoveryProvider(settings, searchProvider);
      const [verification] = buildVerificationProvider();
      return {
        discovery: discoveryProviderStatus(),
        verification: verificationProviderStatus(),
        active_discovery: discovery.name,
        active_discovery_demo: discoveryDemo,
        active_verification: verification.name,
      };
    }),
  );

  api.post(
    "/email/upload",
    upload,
    route(async (req) => {
      const file = fileOf(req);
      try {
        return await parseTable(file.originalname || "", file.buffer);
      } catch (e) {
        const message = (e as Error).message;
        throw new HttpError(400, message.startsWith("Unsupported file type") ? message : `Could not read the file: ${message}`);
      }
    }),
  );

  api.post(
    "/email/domain-search",
    route(async (req) => {
      const payload = parseBody(s.DomainSearchRequest, req.body);
      const [settings, searchProvider] = await emailSearchContext();
      const [discovery] = buildDiscoveryProvider(settings, searchProvider);
      return (await runDomainSearch(db, payload.domain, discovery, settings, { companyName: payload.company_name })).map(s.discoveredOut);
    }),
  );

  api.post(
    "/email/find-by-company",
    route(async (req) => {
      const payload = parseBody(s.FindByCompanyRequest, req.body);
      const [settings, searchProvider] = await emailSearchContext();
      const [discovery] = buildDiscoveryProvider(settings, searchProvider);
      const rows = await runFindByCompany(db, payload.company_name, discovery, settings, { website: payload.website, searchProvider, city: payload.city, state: payload.state });
      return rows.map(s.discoveredOut);
    }),
  );

  api.post(
    "/email/find-by-name",
    route(async (req) => {
      const payload = parseBody(s.FindByNameRequest, req.body);
      const [settings, searchProvider] = await emailSearchContext();
      const [discovery] = buildDiscoveryProvider(settings, searchProvider);
      const rows = await runFindByName(db, payload.first_name, payload.last_name, discovery, settings, { companyName: payload.company_name, domain: payload.domain, searchProvider });
      return rows.map(s.discoveredOut);
    }),
  );

  api.get(
    "/email/discovered",
    route(async (req) => {
      const method = strQuery(req, "method");
      const companyId = intQuery(req, "company_id", null);
      const q = strQuery(req, "q").trim();
      const limit = Math.max(1, Math.min(intQuery(req, "limit", 500)!, 2000));
      const where: string[] = [];
      const params: unknown[] = [];
      if (method) {
        where.push("method = ?");
        params.push(method);
      }
      if (companyId) {
        where.push("company_id = ?");
        params.push(companyId);
      }
      if (q) {
        where.push("(email LIKE ? OR company_name LIKE ? OR full_name LIKE ? OR domain LIKE ?)");
        params.push(...Array(4).fill(`%${q}%`));
      }
      const rows = await db.query<DiscoveredEmail>(`SELECT * FROM cr_discovered_emails ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY id DESC LIMIT ?`, [...params, limit]);
      return rows.map(s.discoveredOut);
    }),
  );

  api.delete(
    "/email/discovered/:id",
    route(async (req) => {
      const id = intParam(req, "id");
      const { affectedRows } = await db.execute("DELETE FROM cr_discovered_emails WHERE id = ?", [id]);
      if (!affectedRows) throw new HttpError(404, "Not found");
      return { deleted: id };
    }),
  );

  api.post(
    "/email/verify",
    route(async (req) => {
      const payload = parseBody(s.VerifyEmailRequest, req.body);
      const [provider] = buildVerificationProvider();
      return s.verificationOut(await verifyOne(db, payload.email, provider));
    }),
  );

  api.get(
    "/email/verifications",
    route(async (req) => {
      const q = strQuery(req, "q").trim();
      const limit = Math.max(1, Math.min(intQuery(req, "limit", 500)!, 2000));
      const rows = await db.query<EmailVerification>(`SELECT * FROM cr_email_verifications ${q ? "WHERE email LIKE ?" : ""} ORDER BY id DESC LIMIT ?`, q ? [`%${q}%`, limit] : [limit]);
      return rows.map(s.verificationOut);
    }),
  );

  // ----------------------------------------------------------------------- bulk jobs
  api.get("/email/jobs/status", route(() => emailJobs.status()));

  api.post(
    "/email/jobs/start",
    route(async (req) => {
      const payload = parseBody(s.EmailJobStart, req.body);
      let items = payload.items;
      if (payload.kind === "verify") {
        [items] = dedupeEmails(items);
        if (!items.length) throw new HttpError(400, "No valid email addresses were given.");
      }
      const status = await jobCall(() => emailJobs.start(payload.kind, items));
      if (payload.kind === "verify" && items.length < payload.items.length) return { ...status, deduplicated: payload.items.length - items.length };
      return status;
    }),
  );
  api.post("/email/jobs/pause", route(() => emailJobs.pause()));
  api.post("/email/jobs/resume", route(() => emailJobs.resume()));
  api.post("/email/jobs/stop", route(() => emailJobs.stop()));

  // ------------------------------------------------------------------------- exports
  const kindOr404 = (kind: string) => {
    if (!EMAIL_EXPORT_PREFIX[kind]) throw new HttpError(404, "Unknown export kind");
    return EMAIL_EXPORT_PREFIX[kind];
  };

  api.get("/email/exports/:kind", route((req) => listFiles(kindOr404(req.params.kind) + "_")));

  api.post(
    "/email/exports/:kind",
    route(async (req) => {
      const prefix = kindOr404(req.params.kind);
      const payload = parseBody(s.EmailExportRequest, req.body);
      const filename = `${prefix}_${stamp()}.xlsx`;
      const file = path.join(exportDir(), filename);
      const where: string[] = [];
      if (req.params.kind === "discovered") {
        if (payload.scope === "verified_only") where.push("verification_status = 'Valid'");
        if (!payload.include_demo) where.push("is_demo = 0");
        const rows = await db.query<DiscoveredEmail>(`SELECT * FROM cr_discovered_emails ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY id DESC`);
        if (!rows.length) throw new HttpError(400, "There are no discovered emails matching this export.");
        await exportDiscoveredEmails(rows, file);
        return { filename, rows: rows.length };
      }
      if (payload.scope === "verified_only") where.push("status = 'Valid'");
      if (!payload.include_demo) where.push("is_demo = 0");
      const rows = await db.query<EmailVerification>(`SELECT * FROM cr_email_verifications ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY id DESC`);
      if (!rows.length) throw new HttpError(400, "There are no verification results matching this export.");
      await exportEmailVerifications(rows, file);
      return { filename, rows: rows.length };
    }),
  );

  const emailExportFile = (kind: string, filename: string) => {
    if (!EMAIL_EXPORT_PREFIX[kind] || !EMAIL_EXPORT_NAME.test(filename)) throw new HttpError(404, "Export not found");
    return exportFile(filename, EMAIL_EXPORT_NAME);
  };

  api.get(
    "/email/exports/:kind/:filename",
    route((req, res) => {
      res.type(XLSX_TYPE).download(emailExportFile(req.params.kind, req.params.filename), req.params.filename);
    }),
  );
  api.delete(
    "/email/exports/:kind/:filename",
    route((req) => {
      unlinkSync(emailExportFile(req.params.kind, req.params.filename));
      return { deleted: req.params.filename };
    }),
  );

  api.use((_req, _res, next) => next(new HttpError(404, "Not Found")));
  api.use(((err, _req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ detail: err.detail });
    if (err?.type === "entity.parse.failed") return res.status(422).json({ detail: [{ loc: ["body"], msg: "JSON decode error", type: "json_invalid" }] });
    if (err instanceof multer.MulterError) return res.status(400).json({ detail: `Could not read the file: ${err.message}` });
    console.error("[company-research]", err);
    res.status(500).json({ detail: "Internal Server Error" });
  }) as express.ErrorRequestHandler);

  app.use("/api", api);
  // The built React UI (frontend/dist) — relative asset paths, so it works under any prefix.
  app.use(express.static(path.join(ROOT, "frontend", "dist")));
  return app;
}
