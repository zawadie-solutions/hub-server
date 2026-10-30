import { timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import express from "express";
import type { AsanaClient } from "../asana/client";
import type { AsanaSettings } from "../asana/sync";
import type { ReviewRepo } from "../db/repo";
import type { AccountStatus } from "../google/accounts";
import type { PlaceReviews } from "../google/placesChecker";
import { logger } from "../logger";
import { checkWithConfirmation, prepareChecker } from "../monitor/cycle";
import { runMonthCheck, type RunProgress, type RunSelection } from "../monitor/runMonth";
import type { RuntimeSettings } from "../settings";
import type { Notifier, ReviewChecker } from "../types";
import { dashboardHtml } from "./dashboard";
import { loginHtml } from "./login";
import { nextScheduledRun } from "./schedule";
import { createSession, LoginThrottle, readCookie, SESSION_COOKIE, SESSION_TTL_MS, verifySession } from "./session";

const asset = (name: string) => fileURLToPath(new URL(`./assets/${name}`, import.meta.url));
const logoPath = asset("logo.png");
/** Logos shown on the links out to Google Maps and Asana. */
const linkLogos: Record<string, string> = { "google-maps.png": asset("google-maps.png"), "asana.png": asset("asana.png") };

/** Stored as the run's error so the dashboard can say "cancelled" instead of "failed". */
const CANCELLED = "cancelled";

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

const LEGACY_QUERY = "Legacy Monthly Disputes";
const isLegacyProject = (name: string) => /legacy monthly disputes/i.test(name);

/**
 * Legacy projects go section > dealership > dispute, with no month task, so the month is
 * labelled with the project's own name. (The location falls back to the dispute's parent.)
 */
export function settingsFor(base: AsanaSettings, projectName: string): AsanaSettings {
  return isLegacyProject(projectName) ? { ...base, monthLabel: projectName.trim() } : base;
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/**
 * Orders month projects newest first. Names vary ("October Managed Disputes 2026",
 * "Managed Disputes V2 2025 June", "May_2025 Legacy Monthly Disputes"), so the month word and
 * year are found anywhere in the name. Within a month, Managed comes before Legacy. Projects
 * without both (e.g. "Managed Disputes Cancellations") go last, alphabetically.
 */
export function byMonthNewestFirst(a: { name: string }, b: { name: string }): number {
  // Letter/digit lookarounds rather than \b, which treats "_" as part of a word ("May_2025").
  const key = (name: string) => {
    const year = name.match(/(?<!\d)(20\d{2})(?!\d)/)?.[1];
    const month = MONTHS.findIndex((m) => new RegExp(`(?<![a-z])${m}(?![a-z])`, "i").test(name));
    return year && month >= 0 ? Number(year) * 12 + month : null;
  };
  const ka = key(a.name), kb = key(b.name);
  if (ka !== null && kb !== null && ka !== kb) return kb - ka;
  if (ka === null && kb !== null) return 1;
  if (ka !== null && kb === null) return -1;
  return Number(isLegacyProject(a.name)) - Number(isLegacyProject(b.name)) || a.name.trim().localeCompare(b.name.trim());
}

/** Enables the month picker + "Run now" button. Omit to run dashboard-only (e.g. the demo preview). */
export interface MonthRunnerOpts {
  client: AsanaClient;
  asanaSettings: AsanaSettings;
  /** Throws if Google credentials aren't configured — caught and treated as "sync only". */
  buildChecker: (opts?: { fast?: boolean; maxReviews?: number }) => ReviewChecker;
  /** Throws if no notifier is configured — caught and treated as "don't notify". */
  buildNotifier: () => Notifier;
  checkDelayMs: number;
  removalRecheckDelayMs: number;
  keepCheckingRemoved?: boolean;
  /** Run now skips the Asana sync when the month was synced within this many minutes (0 or absent = always sync). */
  syncFreshMinutes?: () => number;
}

/** What the Configure page shows. */
export interface ConfigView {
  settings: RuntimeSettings;
  overridden: boolean;
  sources: { id: string; label: string; configured: boolean }[];
  schedule: { cron: string; timezone: string; nextCheckAt: string | null };
  connections: { label: string; ok: boolean; detail: string }[];
}

/** Backs the Configure page. Omit to serve a dashboard without it (e.g. the demo preview). */
export interface ConfigStore {
  view(): Promise<ConfigView>;
  /** Validates and saves; throws an Error whose message can be shown to the user. */
  update(input: Record<string, unknown>, actor: string): Promise<{ changes: string[] }>;
  reset(actor: string): Promise<void>;
  accounts(): Promise<AccountStatus[]>;
  dailyCheckEnabled(): boolean;
}

/** Something running for a month in this process: a full check, or a sync from Asana only. */
interface LiveRun {
  kind: "check" | "sync";
  progress: RunProgress | null;
  cancelRequested: boolean;
}

/** Audit page filters -> the action prefixes they cover. */
const AUDIT_FILTERS: Record<string, string[]> = {
  checks: ["run.", "sync.", "location.", "daily.", "google."],
  settings: ["settings."],
  system: ["system."],
};

/** "Run options": check only the first or last N reviews of the month. Absent = all. Throws a message fit to show. */
function parseSelection(input: unknown): RunSelection | undefined {
  if (input === undefined || input === null) return undefined;
  const s = input as { from?: unknown; count?: unknown };
  if (s.from !== "first" && s.from !== "last") throw new Error("Choose either the first or the last reviews");
  if (typeof s.count !== "number" || !Number.isInteger(s.count) || s.count < 1 || s.count > 1_000_000) throw new Error("The number of reviews to check must be a whole number of 1 or more");
  return { from: s.from, count: s.count };
}

/** "Run options": Google reviews to look through per location, for this run. Absent = the Configure value. */
function parseDepth(input: unknown): number | undefined {
  if (input === undefined || input === null) return undefined;
  if (typeof input !== "number" || !Number.isInteger(input) || input < 0 || input > 20_000) throw new Error("Google reviews per location must be a whole number from 0 to 20,000");
  return input;
}

const plural = (n: number, word: string) => `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;

/** Dashboard behind a sign-in form: monitoring views, on-demand checks, the audit log and settings. */
export function createApp(opts: {
  repo: ReviewRepo;
  user: string;
  password: string;
  scheduleCron: string;
  timezone: string;
  monthRunner?: MonthRunnerOpts;
  /** Enables the "Load Google reviews" button. Omit when no reviews source key is configured. */
  loadPlaceReviews?: (location: string, reviewUrls: string[]) => Promise<PlaceReviews | null>;
  config?: ConfigStore;
  /**
   * Set when the dashboard runs inside the Zawadie hub: the hub has already signed the
   * person in, so this returns who they are and the dashboard's own sign-in is not used.
   */
  hub?: { userOf: (req: express.Request) => string | null; signOutPath: string };
}) {
  if (!opts.hub && !opts.password) throw new Error("DASHBOARD_PASSWORD must be set; refusing to serve an open dashboard");
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  const credentialsOk = (user: unknown, password: unknown) =>
    typeof user === "string" && typeof password === "string" && safeEqual(user, opts.user) && safeEqual(password, opts.password);
  const https = (req: express.Request) => req.secure || req.headers["x-forwarded-proto"] === "https";
  const sessionCookie = (req: express.Request, value: string, maxAgeSeconds: number) =>
    `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${https(req) ? "; Secure" : ""}`;
  /** Who is signed in on this request: from the session cookie, or Basic credentials sent by a script. */
  const signedIn = (req: express.Request): string | null => {
    if (opts.hub) return opts.hub.userOf(req);
    const fromCookie = verifySession(readCookie(req.headers.cookie, SESSION_COOKIE), opts.password);
    if (fromCookie) return fromCookie;
    const [scheme, token] = (req.headers.authorization ?? "").split(" ");
    if (scheme === "Basic" && token) {
      const [u, ...rest] = Buffer.from(token, "base64").toString().split(":");
      if (credentialsOk(u, rest.join(":"))) return u;
    }
    return null;
  };

  // The sign-in page and the logo it shows are the only things reachable without signing in.
  const throttle = new LoginThrottle();
  app.get("/logo.png", (_req, res) => res.sendFile(logoPath));
  if (opts.hub) {
    // Signing in and out is the hub's job; 307 keeps the "Log out" POST a POST.
    const { signOutPath } = opts.hub;
    app.get("/login", (_req, res) => res.redirect("./"));
    app.post("/logout", (_req, res) => res.redirect(307, signOutPath));
  }
  app.get("/login", (req, res) => {
    if (signedIn(req)) return res.redirect("./");
    res.type("html").send(loginHtml());
  });
  app.post("/login", (req, res) => {
    const address = req.ip ?? "unknown";
    const wait = throttle.blockedFor(address);
    const body = (req.body ?? {}) as { user?: unknown; password?: unknown };
    const user = typeof body.user === "string" ? body.user : "";
    if (wait) {
      return res.status(429).type("html").send(loginHtml({ user, error: `Too many wrong attempts. Try again in ${wait} minute${wait === 1 ? "" : "s"}.` }));
    }
    if (!credentialsOk(body.user, body.password)) {
      throttle.failed(address);
      logger.warn({ address }, "failed dashboard sign-in");
      return res.status(401).type("html").send(loginHtml({ user, error: "That username or password is not right." }));
    }
    throttle.succeeded(address);
    res.set("Set-Cookie", sessionCookie(req, createSession(opts.user, opts.password), Math.floor(SESSION_TTL_MS / 1000)));
    res.redirect("./");
  });
  app.post("/logout", (req, res) => {
    res.set("Set-Cookie", sessionCookie(req, "", 0));
    res.redirect("login");
  });

  app.use((req, res, next) => {
    const user = signedIn(req);
    if (!user) {
      // A page goes to the sign-in form; an API call gets a plain 401 the page can react to.
      if (req.path.startsWith("/api/")) return res.status(401).json({ error: "not signed in" });
      return res.redirect(req.baseUrl + "/login");
    }
    // The session lives in a cookie, so a request that changes something must come from this site itself.
    const origin = req.headers.origin;
    if (req.method !== "GET" && req.method !== "HEAD" && origin && new URL(origin).host !== req.headers.host) {
      return res.status(403).json({ error: "cross-site request refused" });
    }
    res.locals.user = user;
    next();
  });

  /** The signed-in dashboard user for a request being handled (set by the sign-in check above). */
  const users = new WeakMap<express.Request, string>();
  const actorOf = (req: express.Request): string => users.get(req) ?? "unknown";

  const api =
    (fn: (req: express.Request) => Promise<unknown>): express.RequestHandler =>
    async (req, res) => {
      try {
        users.set(req, res.locals.user as string);
        res.json(await fn(req));
      } catch (e) {
        logger.error({ err: (e as Error).message, path: req.path }, "request failed");
        res.status(500).json({ error: "internal error" });
      }
    };

  /** Writes to the audit log; a failure here must never break the action being recorded. */
  const audit = (actor: string, action: string, summary: string) =>
    opts.repo.addAudit({ actor, action, summary }).catch((e) => logger.error({ err: (e as Error).message, action }, "audit write failed"));
  const monthName = async (projectGid: string) => (await opts.repo.listAsanaProjects()).find((p) => p.project_gid === projectGid)?.display_name.trim() ?? projectGid;

  const projectGidParam = (req: express.Request): string | undefined => {
    const p = req.query.project;
    return typeof p === "string" && p ? p : undefined;
  };

  app.get("/", (_req, res) => res.type("html").send(dashboardHtml));
  app.get("/assets/:name", (req, res) => {
    const file = linkLogos[req.params.name];
    if (file) res.sendFile(file);
    else res.status(404).send("Not found");
  });
  app.get(
    "/api/summary",
    api(async (req) => ({
      ...(await opts.repo.summary(projectGidParam(req))),
      nextCheckAt: opts.config && !opts.config.dailyCheckEnabled() ? null : (nextScheduledRun(opts.scheduleCron, opts.timezone)?.toISOString() ?? null),
    })),
  );
  app.get("/api/months", api(() => opts.repo.distinctProjects()));
  app.get("/api/removed", api((req) => opts.repo.removedReviews({ projectGid: projectGidParam(req) })));
  app.get("/api/locations", api((req) => opts.repo.locations(projectGidParam(req))));
  app.get(
    "/api/reviews",
    api((req) => {
      const l = req.query.location;
      return opts.repo.reviewsByLocation({ projectGid: projectGidParam(req), location: typeof l === "string" ? l : null });
    }),
  );
  app.get("/api/activity",api((req) => opts.repo.recentActivity({ projectGid: projectGidParam(req) })));

  app.get(
    "/api/audit",
    api(async (req) => {
      const before = Number(req.query.before);
      const filter = typeof req.query.filter === "string" ? AUDIT_FILTERS[req.query.filter] : undefined;
      const limit = 50;
      const rows = await opts.repo.listAudit({ limit: limit + 1, beforeId: Number.isInteger(before) && before > 0 ? before : undefined, prefixes: filter });
      return { entries: rows.slice(0, limit), more: rows.length > limit };
    }),
  );

  app.get("/api/config", api(async () => (opts.config ? { available: true, ...(await opts.config.view()) } : { available: false })));
  app.get("/api/accounts", api(async () => (opts.config ? opts.config.accounts() : [])));
  app.put(
    "/api/config",
    api(async (req) => {
      if (!opts.config) return { ok: false, reason: "settings cannot be changed in this environment" };
      try {
        const { changes } = await opts.config.update((req.body ?? {}) as Record<string, unknown>, actorOf(req));
        return { ok: true, changes, ...(await opts.config.view()) };
      } catch (e) {
        return { ok: false, reason: (e as Error).message };
      }
    }),
  );
  app.post(
    "/api/config/reset",
    api(async (req) => {
      if (!opts.config) return { ok: false, reason: "settings cannot be changed in this environment" };
      await opts.config.reset(actorOf(req));
      return { ok: true, ...(await opts.config.view()) };
    }),
  );

  // Every "<Month> Managed Disputes <Year>" and "<Month> <Year> Legacy Monthly Disputes" project
  // Asana knows about, synced or not, with run status. `legacy` marks the second kind.
  let workspaceGid: string | undefined;
  app.get(
    "/api/available-months",
    api(async () => {
      if (!opts.monthRunner) return [];
      const { client, asanaSettings } = opts.monthRunner;
      workspaceGid ??= await client.projectWorkspace(asanaSettings.projectGid);
      const [managed, legacy, known, stored] = await Promise.all([
        client.searchProjects(workspaceGid, "Managed Disputes"),
        client.searchProjects(workspaceGid, LEGACY_QUERY),
        opts.repo.listAsanaProjects(),
        opts.repo.distinctProjects(),
      ]);
      const knownByGid = new Map(known.map((k) => [k.project_gid, k]));
      const disputesByGid = new Map(stored.map((x) => [x.projectGid, x.count]));
      const found = new Map([...managed, ...legacy].map((p) => [p.gid, p]));
      return [...found.values()]
        .filter((p) => !p.archived && !/template/i.test(p.name))
        .sort(byMonthNewestFirst)
        .map((p) => {
          const k = knownByGid.get(p.gid);
          return {
            projectGid: p.gid,
            name: p.name,
            legacy: isLegacyProject(p.name),
            lastSyncedAt: k?.last_synced_at ?? null,
            lastReviewCount: k?.last_review_count ?? null,
            // Disputes stored from the month's last sync; 0 when it has never been synced.
            disputes: disputesByGid.get(p.gid) ?? 0,
            runStatus: k?.run_status ?? "idle",
            lastRunError: k?.last_run_error ?? null,
          };
        });
    }),
  );

  // Runs live in this process, so their progress and cancel flags do too (lost on restart,
  // which is also when start.ts clears the 'running' marks they leave behind).
  const liveRuns = new Map<string, LiveRun>();

  app.get(
    "/api/run-progress",
    api(async (req) => {
      const run = liveRuns.get(projectGidParam(req) ?? "");
      return run ? { running: true, kind: run.kind, cancelRequested: run.cancelRequested, ...run.progress } : { running: false };
    }),
  );

  // Asks the run to stop after the review it is on. A month marked running with no live run
  // behind it (left over from a restart) is simply released.
  app.post(
    "/api/cancel-run",
    api(async (req) => {
      const projectGid = (req.body as { projectGid?: string })?.projectGid;
      if (!projectGid) throw new Error("projectGid required");
      const run = liveRuns.get(projectGid);
      if (run) run.cancelRequested = true;
      else await opts.repo.finishAsanaRun(projectGid, { ok: false, error: CANCELLED });
      await audit(actorOf(req), "run.cancel_requested", `Asked to cancel the check of ${await monthName(projectGid)}`);
      return { ok: true };
    }),
  );

  // Runs in the background; the response just confirms it started. The dashboard polls
  // /api/available-months for status. Always notifies on anything found removed, the same
  // as the live daily job would — this is "do the 07:00 run early", not a quiet look-back.
  app.post(
    "/api/run-month",
    api(async (req) => {
      if (!opts.monthRunner) return { started: false, reason: "not configured in this environment" };
      const body = req.body as { projectGid?: string; name?: string; select?: unknown; maxReviews?: unknown; forceSync?: unknown };
      if (!body?.projectGid) throw new Error("projectGid required");
      const { projectGid } = body;
      const displayName = body.name ?? projectGid;

      // Options chosen for this run only (see "Run options" on the dashboard).
      let select: RunSelection | undefined;
      let maxReviews: number | undefined;
      try {
        select = parseSelection(body.select);
        maxReviews = parseDepth(body.maxReviews);
      } catch (e) {
        return { started: false, reason: (e as Error).message };
      }

      const claimed = await opts.repo.tryStartAsanaRun(projectGid, displayName);
      if (!claimed) return { started: false, reason: "already running" };

      const runner = opts.monthRunner;
      const actor = actorOf(req);
      const month = displayName.trim();
      const live: LiveRun = { kind: "check", progress: null, cancelRequested: false };
      liveRuns.set(projectGid, live);
      const scope = [
        select ? `the ${select.from} ${plural(select.count, "review")}` : "",
        maxReviews !== undefined ? (maxReviews === 0 ? "looking through every Google review per location" : `looking through the newest ${plural(maxReviews, "Google review")} per location`) : "",
      ].filter(Boolean);
      await audit(actor, "run.started", `Started a check of ${month}${scope.length ? ` (${scope.join(", ")})` : ""}`);
      void (async () => {
        let checker: ReviewChecker | null = null;
        try {
          checker = runner.buildChecker({ maxReviews });
        } catch {
          // Google not configured: sync only.
        }
        let notifier: Notifier | null = null;
        try {
          notifier = runner.buildNotifier();
        } catch {
          // No notifier configured: don't notify.
        }
        try {
          const result = await runMonthCheck({
            projectGid,
            client: runner.client,
            asanaSettings: settingsFor(runner.asanaSettings, month),
            repo: opts.repo,
            checker,
            notifier,
            checkDelayMs: runner.checkDelayMs,
            removalRecheckDelayMs: runner.removalRecheckDelayMs,
            keepCheckingRemoved: runner.keepCheckingRemoved,
            retireAfterRun: projectGid !== runner.asanaSettings.projectGid,
            onState: (p) => (live.progress = p),
            isCancelled: () => live.cancelRequested,
            select,
            skipSyncIfSyncedWithinMs: body.forceSync === true ? 0 : (runner.syncFreshMinutes?.() ?? 0) * 60_000,
          });
          await opts.repo.finishAsanaRun(projectGid, result.cancelled ? { ok: false, error: CANCELLED } : { ok: true, reviewCount: result.reviewsFound, synced: result.synced });
          const counts = `${result.synced ? "synced from Asana first; " : "used the recent Asana sync; "}${plural(result.checked, "review")} checked, ${result.removed.toLocaleString("en-US")} removed, ${result.unknown.toLocaleString("en-US")} could not be checked`;
          if (result.cancelled) await audit(actor, "run.cancelled", `Check of ${month} cancelled part-way: ${counts}${result.notified ? "; removal alert sent" : ""}`);
          else if (!result.checkedGoogle) await audit(actor, "run.finished", `Synced ${month} from Asana (${plural(result.reviewsFound, "review")}); no review source is set up, so nothing was checked`);
          else await audit(actor, "run.finished", `Check of ${month} finished: ${counts}${result.notified ? "; removal alert sent" : ""}`);
        } catch (e) {
          logger.error({ err: (e as Error).message, projectGid }, "run-month failed");
          await opts.repo.finishAsanaRun(projectGid, { ok: false, error: (e as Error).message }).catch(() => {});
          await audit(actor, "run.failed", `Check of ${month} failed: ${(e as Error).message}`);
        } finally {
          liveRuns.delete(projectGid);
        }
      })();

      return { started: true };
    }),
  );

  // Sync only: refreshes one month's review tasks (links, names, who is working on them) from
  // Asana, without checking anything against Google, so it costs nothing. It claims the month
  // the same way a check does, so the two can never run for the same month at once.
  app.post(
    "/api/sync-month",
    api(async (req) => {
      if (!opts.monthRunner) return { started: false, reason: "not configured in this environment" };
      const body = req.body as { projectGid?: string; name?: string };
      if (!body?.projectGid) throw new Error("projectGid required");
      const { projectGid } = body;
      const month = (body.name ?? projectGid).trim();

      const claimed = await opts.repo.tryStartAsanaRun(projectGid, body.name ?? projectGid);
      if (!claimed) return { started: false, reason: "a check or sync is already running for this month" };

      const runner = opts.monthRunner;
      const actor = actorOf(req);
      const live: LiveRun = { kind: "sync", progress: null, cancelRequested: false };
      liveRuns.set(projectGid, live);
      await audit(actor, "sync.started", `Started syncing ${month} from Asana`);
      void (async () => {
        try {
          const result = await runMonthCheck({
            projectGid,
            client: runner.client,
            asanaSettings: settingsFor(runner.asanaSettings, month),
            repo: opts.repo,
            checker: null, // sync only
            notifier: null,
            checkDelayMs: 0,
            removalRecheckDelayMs: 0,
            retireAfterRun: false,
            onState: (p) => (live.progress = p),
          });
          await opts.repo.finishAsanaRun(projectGid, { ok: true, reviewCount: result.reviewsFound });
          await audit(actor, "sync.finished", `Synced ${month} from Asana: ${plural(result.reviewsFound, "review")} across ${plural(result.tasksScanned, "task")} scanned`);
        } catch (e) {
          logger.error({ err: (e as Error).message, projectGid }, "sync-month failed");
          await opts.repo.finishAsanaRun(projectGid, { ok: false, error: (e as Error).message }).catch(() => {});
          await audit(actor, "sync.failed", `Sync of ${month} from Asana failed: ${(e as Error).message}`);
        } finally {
          liveRuns.delete(projectGid);
        }
      })();

      return { started: true };
    }),
  );

  // Display only: the reviews Google currently shows for the selected location. Reads the
  // location's Asana links to identify the place; writes nothing.
  app.get(
    "/api/places-reviews",
    api(async (req) => {
      if (!opts.loadPlaceReviews) return { ok: false, reason: "no key is configured for the reviews source set in REVIEW_CHECKER" };
      const location = req.query.location;
      if (typeof location !== "string" || !location) return { ok: false, reason: "this location has no name to search for" };
      const rows = await opts.repo.reviewsByLocation({ projectGid: projectGidParam(req), location });
      try {
        const place = await opts.loadPlaceReviews(location, rows.map((r) => r.google_review_url));
        if (place) await audit(actorOf(req), "google.loaded", `Loaded the latest Google reviews for ${location}`);
        return place ? { ok: true, place } : { ok: false, reason: "could not find this business on Google" };
      } catch (e) {
        return { ok: false, reason: (e as Error).message };
      }
    }),
  );

  // Checks just one location's reviews for the selected month and answers when done. Does not
  // notify by itself: a removal it records is picked up by the next daily run like any other.
  const checkingLocations = new Set<string>();
  app.post(
    "/api/check-location",
    api(async (req) => {
      if (!opts.monthRunner) return { ok: false, reason: "not configured in this environment" };
      const body = req.body as { projectGid?: string; location?: string | null };
      const projectGid = typeof body?.projectGid === "string" && body.projectGid ? body.projectGid : undefined;
      const location = typeof body?.location === "string" ? body.location : null;

      const key = `${projectGid ?? ""}|${location ?? ""}`;
      if (checkingLocations.has(key)) return { ok: false, reason: "already running" };
      const runner = opts.monthRunner;
      let checker: ReviewChecker;
      try {
        checker = runner.buildChecker({ fast: true });
      } catch (e) {
        return { ok: false, reason: (e as Error).message };
      }

      checkingLocations.add(key);
      try {
        const s = { ok: true, checked: 0, exists: 0, removed: 0, unknown: 0 };
        const rows = await opts.repo.reviewsByLocation({ projectGid, location });
        await prepareChecker(checker, rows);
        for (const row of rows) {
          const result = await checkWithConfirmation({ checker, removalRecheckDelayMs: runner.removalRecheckDelayMs }, row);
          await opts.repo.recordCheck(row, result);
          s.checked++;
          if (result.status === "REVIEW_EXISTS") s.exists++;
          else if (result.status === "REVIEW_REMOVED") s.removed++;
          else s.unknown++;
        }
        await audit(
          actorOf(req),
          "location.checked",
          `Checked ${location ?? "reviews with no location"}: ${plural(s.checked, "review")} — ${s.exists} still available, ${s.removed} removed, ${s.unknown} could not be checked`,
        );
        return s;
      } finally {
        checkingLocations.delete(key);
      }
    }),
  );

  return app;
}
