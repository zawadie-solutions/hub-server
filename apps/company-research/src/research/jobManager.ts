/**
 * Background research jobs: START / PAUSE / RESUME / STOP with live progress.
 *
 * Research runs in the background so the API (and the UI) never blocks. Every company is saved as
 * soon as it finishes; unfinished companies stay flagged `queued` in the database, so after a
 * crash or restart the job comes back PAUSED and continues from the first unfinished company.
 */
import type { ConfigStore } from "../config";
import type { Db } from "../db/db";
import { getCompany, inList } from "../db/repo";
import { type Company, PENDING, RESEARCHING } from "../models";
import type { SearchProvider } from "../providers/base";
import { type SearchEvent, SearchManager } from "../providers/manager";
import { buildChain } from "../providers/registry";
import { getLogger } from "../utils/logger";
import { RateLimiter } from "../utils/rateLimit";
import { ResearchEngine, STEPS, StopResearch } from "./engine";
import { Gate, JobConflictError, JobInputError, Mutex, sleep } from "./jobControl";
import { PageFetcher } from "./pageFetcher";

const log = getLogger("jobs");

type State = "idle" | "running" | "paused" | "stopping";
type ChainBuilder = () => Promise<[SearchProvider[], boolean]>;

interface CurrentEntry {
  company_id: number;
  company_name: string;
  steps: { key: string; label: string; state: string; detail: string }[];
}

export class JobManager {
  state: State = "idle";
  private chainBuilder: ChainBuilder;
  private control = new Mutex();
  private resumeGate = new Gate();
  private stopRequested = false;
  private runPromise: Promise<void> | null = null;
  private pending: number[] = [];
  private total = 0;
  private completed = 0;
  private failed = 0;
  private current = new Map<number, CurrentEntry>();
  private recent: Record<string, unknown>[] = [];
  private events: SearchEvent[] = [];
  private providers: string[] = [];
  private demo = false;
  private startedAt: number | null = null;
  private restored = false;

  constructor(
    private db: Db,
    private config: ConfigStore,
    chainBuilder?: ChainBuilder,
  ) {
    this.chainBuilder = chainBuilder ?? (async () => buildChain(await config.loadProvidersConfig()));
  }

  // ------------------------------------------------------------- persistence
  /** Called at startup: put interrupted companies back in line, paused. */
  async recover(): Promise<void> {
    await this.db.execute("UPDATE cr_companies SET research_status = ?, queued = 1 WHERE research_status = ?", [PENDING, RESEARCHING]);
    const ids = (await this.db.query<{ id: number }>("SELECT id FROM cr_companies WHERE queued = 1 ORDER BY id")).map((r) => r.id);
    if (ids.length) {
      this.pending = ids;
      this.total = ids.length;
      this.completed = this.failed = 0;
      this.state = "paused";
      this.restored = true;
      this.resumeGate.close();
      log.info({ companies: ids.length }, "restored unfinished job (paused)");
    }
  }

  // ----------------------------------------------------------------- control
  start(companyIds?: number[] | null, redo = false) {
    return this.control.run(async () => {
      if (this.state === "running" || this.state === "stopping" || (this.state === "paused" && !this.restored)) {
        throw new JobConflictError("A research job is already active. Stop it before starting another.");
      }
      let sql = "SELECT id FROM cr_companies";
      const where: string[] = [];
      const params: unknown[] = [];
      if (companyIds?.length) {
        where.push("id IN (?)");
        params.push(inList(companyIds));
        if (!redo) where.push("research_status IN ('PENDING', 'FAILED')");
      } else if (!redo) {
        where.push("research_status = 'PENDING'");
      }
      if (where.length) sql += " WHERE " + where.join(" AND ");
      const ids = (await this.db.query<{ id: number }>(sql + " ORDER BY id", params)).map((r) => r.id);
      if (!ids.length) throw new JobInputError("No companies are waiting for research.");
      await this.db.transaction(async (tx) => {
        await tx.execute("UPDATE cr_companies SET queued = 0");
        await tx.execute("UPDATE cr_companies SET queued = 1, research_status = ? WHERE id IN (?)", [PENDING, ids]);
      });
      this.launch(ids);
      return this.status();
    });
  }

  private launch(ids: number[]): void {
    this.pending = [...ids];
    this.total = ids.length;
    this.completed = this.failed = 0;
    this.current.clear();
    this.recent = [];
    this.events = [];
    this.restored = false;
    this.stopRequested = false;
    this.resumeGate.open();
    this.state = "running";
    this.startedAt = Date.now() / 1000;
    this.runPromise = this.run().catch((e) => log.error({ err: (e as Error).message }, "research job crashed"));
  }

  pause() {
    return this.control.run(() => {
      if (this.state === "running") {
        this.resumeGate.close();
        this.state = "paused";
      }
      return this.status();
    });
  }

  resume() {
    return this.control.run(() => {
      if (this.state === "paused" && this.restored) this.launch(this.pending);
      else if (this.state === "paused") {
        this.state = "running";
        this.resumeGate.open();
      }
      return this.status();
    });
  }

  stop() {
    return this.control.run(async () => {
      if (this.state === "paused" && this.restored) {
        await this.clearQueue();
        this.pending = [];
        this.total = 0;
        this.state = "idle";
        this.restored = false;
      } else if (this.state === "running" || this.state === "paused") {
        this.state = "stopping";
        this.stopRequested = true;
        this.resumeGate.open(); // wake paused workers so they can exit
      }
      return this.status();
    });
  }

  /** Resolves when the current run has finished. */
  async wait(): Promise<void> {
    await this.runPromise;
  }

  // ------------------------------------------------------------------ worker
  private async checkpoint(): Promise<void> {
    await this.resumeGate.wait();
    if (this.stopRequested) throw new StopResearch();
  }

  private onProgress(companyId: number, key: string, state: string, detail: string): void {
    const entry = this.current.get(companyId);
    if (!entry) return;
    for (const step of entry.steps) {
      if (step.key === key) {
        step.state = state;
        step.detail = detail;
      }
    }
  }

  private async run(): Promise<void> {
    try {
      const settings = await this.config.loadSettings();
      const [providers, demo] = await this.chainBuilder();
      const limiter = new RateLimiter(demo ? 0 : settings.request_delay_seconds);
      const manager = new SearchManager(providers, {
        rateLimiter: limiter,
        maxRetries: settings.max_retries,
        maxConcurrent: settings.max_concurrent_searches,
        onEvent: (event) => {
          this.events.push(event);
          if (this.events.length > 30) this.events.shift();
        },
      });
      this.providers = providers.map((p) => p.name);
      this.demo = demo;
      const engine = new ResearchEngine(this.db, manager, settings, {
        checkpoint: () => this.checkpoint(),
        progress: (...args) => this.onProgress(...args),
        pageFetcher: demo ? null : new PageFetcher(() => limiter.wait()),
        demoProviders: providers.filter((p) => p.isDemo).map((p) => p.name),
      });
      const queue = [...this.pending];
      const worker = async () => {
        for (let id = queue.shift(); id !== undefined; id = queue.shift()) await this.researchOne(engine, id, demo);
      };
      await Promise.all(Array.from({ length: settings.max_concurrent_searches }, worker));
    } finally {
      if (this.stopRequested) await this.clearQueue().catch((e) => log.error({ err: (e as Error).message }, "could not clear the queue"));
      this.current.clear();
      this.pending = [];
      this.state = "idle";
    }
  }

  private async researchOne(engine: ResearchEngine, companyId: number, demo: boolean): Promise<void> {
    try {
      await this.checkpoint();
    } catch {
      return;
    }
    const company = await getCompany(this.db, companyId);
    if (!company) {
      this.done(companyId, null);
      return;
    }
    this.current.set(companyId, {
      company_id: companyId,
      company_name: company.company_name,
      steps: STEPS.map(([key, label]) => ({ key, label, state: "pending", detail: "" })),
    });
    if (demo) await sleep(150); // keeps the demo progress display readable
    try {
      this.done(companyId, await engine.researchCompany(companyId));
    } catch (e) {
      if (e instanceof StopResearch) {
        this.current.delete(companyId);
        return;
      }
      log.error({ err: (e as Error).message, companyId }, "worker crashed");
      this.done(companyId, null);
    }
  }

  private done(companyId: number, company: Company | null): void {
    this.current.delete(companyId);
    const i = this.pending.indexOf(companyId);
    if (i >= 0) this.pending.splice(i, 1);
    this.completed++;
    if (!company || company.research_status === "FAILED") this.failed++;
    if (company) {
      this.recent.unshift({
        company_id: company.id,
        company_name: company.company_name,
        research_status: company.research_status,
        verification_status: company.verification_status,
        confidence: company.confidence,
        owner_name: company.owner_name,
      });
      if (this.recent.length > 15) this.recent.pop();
    }
  }

  /** User pressed STOP: unfinished companies go back to PENDING and leave the job. */
  private async clearQueue(): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.execute("UPDATE cr_companies SET research_status = ? WHERE research_status = ?", [PENDING, RESEARCHING]);
      await tx.execute("UPDATE cr_companies SET queued = 0");
    });
  }

  // ------------------------------------------------------------------ status
  status() {
    return {
      state: this.state,
      restored: this.restored,
      total: this.total,
      completed: this.completed,
      failed: this.failed,
      remaining: Math.max(0, this.total - this.completed),
      current: [...this.current.values()].map((entry) => ({ ...entry, steps: entry.steps.map((s) => ({ ...s })) })),
      recent: [...this.recent],
      events: this.events.slice(-12),
      providers: [...this.providers],
      demo_mode: this.demo,
      started_at: this.startedAt,
    };
  }
}
