/**
 * Background bulk jobs for the email features: START / PAUSE / RESUME / STOP with progress.
 *
 * One job runs at a time (mirrors the company-research JobManager). `pending_items` on the
 * cr_email_jobs row is the durable queue: every processed item is already saved as a
 * discovered-email or verification row by the worker itself, so after a crash or restart only
 * the remaining items need to be recovered — nothing already done is re-done or lost.
 */
import type { Db } from "../db/db";
import { insertRow, updateRow } from "../db/repo";
import { type EmailJob, JOB_COMPLETED, JOB_PAUSED, JOB_RUNNING, JOB_STOPPED } from "../models";
import { getLogger } from "../utils/logger";
import { Gate, JobConflictError, JobInputError, Mutex } from "./jobControl";

const log = getLogger("email_jobs");

type State = "idle" | "running" | "paused" | "stopping";
export type Item = Record<string, any>;

/**
 * Given the job's id, returns a fresh [processOne, provider label, isDemo] for each run, so it
 * always reflects whatever Settings/API keys are configured right now.
 */
export type WorkerFactory = (jobId: number) => Promise<[(item: Item) => Promise<void>, string, boolean]>;

class StopEmailJob extends Error {}

export class EmailJobManager {
  state: State = "idle";
  private workers = new Map<string, WorkerFactory>();
  private control = new Mutex();
  private resumeGate = new Gate();
  private stopRequested = false;
  private runPromise: Promise<void> | null = null;
  private jobId: number | null = null;
  private kind = "";
  private pendingItems: Item[] = [];
  private total = 0;
  private completed = 0;
  private failed = 0;
  private currentItem: Item | null = null;
  private recent: Item[] = [];
  private providerUsed = "";
  private isDemo = false;
  private restored = false;
  private startedAt: number | null = null;

  constructor(private db: Db) {}

  register(kind: string, factory: WorkerFactory): void {
    this.workers.set(kind, factory);
  }

  // ------------------------------------------------------------- persistence
  /** Called at startup: an interrupted job comes back paused, ready to RESUME. */
  async recover(): Promise<void> {
    await this.db.execute("UPDATE cr_email_jobs SET status = ? WHERE status = ?", [JOB_PAUSED, JOB_RUNNING]);
    const [job] = await this.db.query<EmailJob>("SELECT * FROM cr_email_jobs WHERE status = ? ORDER BY id DESC LIMIT 1", [JOB_PAUSED]);
    if (job) {
      this.jobId = job.id;
      this.kind = job.kind;
      this.total = job.total;
      this.completed = job.completed;
      this.failed = job.failed;
      this.pendingItems = [...(job.pending_items ?? [])];
      this.state = "paused";
      this.restored = true;
      this.resumeGate.close();
      log.info({ jobId: job.id, kind: job.kind }, "restored unfinished email job (paused)");
    }
  }

  // ----------------------------------------------------------------- control
  start(kind: string, items: Item[]) {
    return this.control.run(async () => {
      if (this.state === "running" || this.state === "stopping" || (this.state === "paused" && !this.restored)) {
        throw new JobConflictError("An email job is already active. Stop it before starting another.");
      }
      if (!this.workers.has(kind)) throw new JobInputError(`Unknown job kind: ${kind}`);
      if (!items.length) throw new JobInputError("Nothing to process.");
      const now = new Date();
      const jobId = await insertRow(this.db, "cr_email_jobs", { kind, status: JOB_RUNNING, total: items.length, completed: 0, failed: 0, pending_items: items, is_demo: false, created_at: now, updated_at: now });
      this.begin(jobId, kind, items.length, 0, 0, [...items]);
      return this.status();
    });
  }

  private begin(jobId: number, kind: string, total: number, completed: number, failed: number, items: Item[]): void {
    this.jobId = jobId;
    this.kind = kind;
    this.total = total;
    this.completed = completed;
    this.failed = failed;
    this.pendingItems = items;
    this.currentItem = null;
    this.recent = [];
    this.restored = false;
    this.stopRequested = false;
    this.resumeGate.open();
    this.state = "running";
    this.startedAt = Date.now() / 1000;
    this.runPromise = this.run().catch((e) => log.error({ err: (e as Error).message }, "email job crashed"));
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
      if (this.state === "paused" && this.restored) this.begin(this.jobId!, this.kind, this.total, this.completed, this.failed, this.pendingItems);
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
        await this.finalize(JOB_STOPPED, []);
        this.state = "idle";
        this.restored = false;
      } else if (this.state === "running" || this.state === "paused") {
        this.state = "stopping";
        this.stopRequested = true;
        this.resumeGate.open(); // wake a paused worker so it can observe the stop
      }
      return this.status();
    });
  }

  async wait(): Promise<void> {
    await this.runPromise;
  }

  // ------------------------------------------------------------------ worker
  private async checkpoint(): Promise<void> {
    await this.resumeGate.wait();
    if (this.stopRequested) throw new StopEmailJob();
  }

  private async run(): Promise<void> {
    const jobId = this.jobId!;
    let processOne: (item: Item) => Promise<void>;
    try {
      let label: string;
      let demo: boolean;
      [processOne, label, demo] = await this.workers.get(this.kind)!(jobId);
      this.providerUsed = label;
      this.isDemo = demo;
      await updateRow(this.db, "cr_email_jobs", jobId, { provider_used: label, is_demo: demo, updated_at: new Date() });
    } catch (e) {
      log.error({ jobId, err: (e as Error).message }, "email job could not start");
      await updateRow(this.db, "cr_email_jobs", jobId, { status: JOB_STOPPED, error: `${(e as Error).name}: ${(e as Error).message}`, updated_at: new Date() });
      this.state = "idle";
      return;
    }

    const items = [...this.pendingItems];
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      try {
        await this.checkpoint();
      } catch {
        // STOP means abandon the rest of this batch (unlike pause, which keeps it).
        await this.finalize(JOB_STOPPED, []);
        this.state = "idle";
        return;
      }
      this.currentItem = item;
      let ok = true;
      try {
        await processOne(item);
      } catch (e) {
        log.error({ err: (e as Error).message, item }, "email job item failed");
        ok = false;
      }
      this.completed++;
      if (!ok) this.failed++;
      this.currentItem = null;
      this.recent.unshift({ ...item, ok });
      if (this.recent.length > 20) this.recent.pop();
      await this.persistProgress(items.slice(index + 1));
    }
    await this.finalize(JOB_COMPLETED, []);
    this.state = "idle";
  }

  private async persistProgress(remaining: Item[]): Promise<void> {
    this.pendingItems = remaining;
    await updateRow(this.db, "cr_email_jobs", this.jobId!, { pending_items: remaining, completed: this.completed, failed: this.failed, updated_at: new Date() });
  }

  private async finalize(status: string, remaining: Item[]): Promise<void> {
    this.pendingItems = remaining;
    await updateRow(this.db, "cr_email_jobs", this.jobId!, { status, pending_items: remaining, completed: this.completed, failed: this.failed, updated_at: new Date() });
  }

  // ------------------------------------------------------------------ status
  status() {
    return {
      state: this.state,
      job_id: this.jobId,
      kind: this.kind,
      restored: this.restored,
      total: this.total,
      completed: this.completed,
      failed: this.failed,
      remaining: Math.max(0, this.total - this.completed),
      current_item: this.currentItem,
      recent: [...this.recent],
      provider_used: this.providerUsed,
      is_demo: this.isDemo,
      started_at: this.startedAt,
    };
  }
}
