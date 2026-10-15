import type { ReviewRepo } from "../db/repo";
import { logger } from "../logger";
import { notifyPending } from "../notify/service";
import type { CheckResult, Notifier, ReviewChecker, ReviewRow, ReviewToCheck } from "../types";

export interface CycleDeps {
  repo: ReviewRepo;
  checker: ReviewChecker;
  notifier: Notifier;
  /** Pulls new/updated review tasks from Asana into the DB. */
  sync: () => Promise<unknown>;
  removalRecheckDelayMs: number;
  checkDelayMs: number;
  keepCheckingRemoved: boolean;
}

const sleep = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

export const toCheck = (row: ReviewRow): ReviewToCheck => ({
  id: row.id,
  googleReviewUrl: row.google_review_url,
  location: row.location,
  reviewerName: row.reviewer_name,
  rating: row.rating,
});

/** Lets a queue-based checker request every place before the first check; a failure here is not fatal. */
export async function prepareChecker(checker: ReviewChecker, rows: ReviewRow[]): Promise<void> {
  try {
    await checker.prepare?.(rows.map(toCheck));
  } catch (e) {
    logger.warn({ err: (e as Error).message }, "checker prepare failed");
  }
}

/** Run the checker without ever letting an exception turn into anything but UNKNOWN. */
async function safeCheck(checker: ReviewChecker, row: ReviewRow): Promise<CheckResult> {
  try {
    return await checker.checkReview(toCheck(row));
  } catch (e) {
    return { status: "UNKNOWN", reason: `checker threw: ${(e as Error).message}` };
  }
}

/**
 * A REMOVED verdict is only accepted if a second check, after a delay, agrees.
 * Anything else downgrades to EXISTS/UNKNOWN. This is the main guard against false alerts.
 */
export async function checkWithConfirmation(
  deps: Pick<CycleDeps, "checker" | "removalRecheckDelayMs">,
  row: ReviewRow,
): Promise<CheckResult> {
  const first = await safeCheck(deps.checker, row);
  if (first.status !== "REVIEW_REMOVED") return first;
  await sleep(deps.removalRecheckDelayMs);
  const second = await safeCheck(deps.checker, row);
  if (second.status === "REVIEW_REMOVED") return second;
  if (second.status === "REVIEW_EXISTS") return second;
  return { status: "UNKNOWN", reason: `removal not confirmed: ${second.reason}` };
}

export interface CheckSummary {
  checked: number;
  exists: number;
  removed: number;
  unknown: number;
}

export async function checkAll(deps: CycleDeps): Promise<CheckSummary> {
  const s: CheckSummary = { checked: 0, exists: 0, removed: 0, unknown: 0 };
  const rows = await deps.repo.listToCheck();
  await prepareChecker(deps.checker, rows);
  for (const row of rows) {
    const result = await checkWithConfirmation(deps, row);
    try {
      await deps.repo.recordCheck(row, result);
    } catch (e) {
      logger.error({ err: (e as Error).message, reviewId: row.id }, "failed to persist check");
      continue;
    }
    s.checked++;
    if (result.status === "REVIEW_EXISTS") s.exists++;
    else if (result.status === "REVIEW_REMOVED") s.removed++;
    else {
      s.unknown++;
      logger.warn({ reviewId: row.id, reason: result.reason }, "check returned UNKNOWN");
    }
    await sleep(deps.checkDelayMs);
  }
  return s;
}

let running = false;

/** Sync -> check -> notify. Each stage is isolated: a failure in one never blocks the next. */
export async function runCycle(deps: CycleDeps): Promise<{ skipped: boolean; ok: boolean }> {
  if (running) {
    logger.warn("cycle already running; skipping");
    return { skipped: true, ok: false };
  }
  running = true;
  try {
    const results = [
      await stage("sync", () => deps.sync()),
      await stage("check", () => checkAll(deps)),
      await stage("notify", async () => {
        const n = await notifyPending(deps.repo, deps.notifier, { stopCheckingAfterNotify: !deps.keepCheckingRemoved });
        if (n.failed > 0) throw new Error(`${n.failed} removal(s) could not be emailed; will retry next run`);
        return n;
      }),
    ];
    return { skipped: false, ok: results.every(Boolean) };
  } finally {
    running = false;
  }
}

async function stage(kind: string, fn: () => Promise<unknown>): Promise<boolean> {
  try {
    logger.info({ stage: kind, result: await fn() }, "stage ok");
    return true;
  } catch (e) {
    logger.error({ stage: kind, err: (e as Error).message }, "stage failed");
    return false;
  }
}
