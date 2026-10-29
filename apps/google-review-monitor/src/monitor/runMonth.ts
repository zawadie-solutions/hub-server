import type { AsanaClient } from "../asana/client";
import type { AsanaSettings, WalkProgress } from "../asana/sync";
import { syncAsana } from "../asana/sync";
import type { ReviewRepo } from "../db/repo";
import { notifyPending } from "../notify/service";
import type { Notifier, ReviewChecker, ReviewRow } from "../types";
import { checkWithConfirmation, prepareChecker } from "./cycle";

const sleep = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

export interface RunMonthResult {
  tasksScanned: number;
  reviewsFound: number;
  checked: number;
  removed: number;
  unknown: number;
  /** False when Google credentials weren't configured — the sync ran but nothing was checked. */
  checkedGoogle: boolean;
  notified: boolean;
  /** True when the run was stopped early via `isCancelled`; the counts cover what was done. */
  cancelled: boolean;
  /** False when the Asana sync was skipped because the month had been synced recently. */
  synced: boolean;
}

/** Limits a run to part of the month: the first or the last `count` reviews, in run order. */
export interface RunSelection {
  from: "first" | "last";
  count: number;
}

/**
 * Picks the reviews a run will check from the month's reviews (already in run order: by
 * location, then id). Whole locations are kept together — one listing is fetched per
 * location whatever the number of its reviews — so the result is `count` reviews rounded
 * up to the end of the location it lands in. No selection means all of them.
 */
export function selectForRun<T extends { location: string | null }>(rows: T[], select?: RunSelection): T[] {
  if (!select || select.count >= rows.length) return rows;
  const ordered = select.from === "first" ? rows : [...rows].reverse();
  let n = Math.max(1, select.count);
  while (n < ordered.length && ordered[n].location === ordered[n - 1].location) n++;
  const picked = ordered.slice(0, n);
  return select.from === "first" ? picked : picked.reverse();
}

/** Where a run is, for the dashboard's live progress display. */
export interface RunProgress {
  phase: "syncing" | "checking";
  /** Set when the Asana sync was skipped: how old the sync being used is. Null when this run synced. */
  syncedMinutesAgo: number | null;
  /** Location being checked now (null = reviews with no location, or still syncing). */
  location: string | null;
  /** Locations fully checked so far in this run, in order. */
  doneLocations: (string | null)[];
  totalLocations: number;
  reviewsDone: number;
  reviewsTotal: number;
  /** While syncing: how far the read of Asana has got. Null before it starts and once checking. */
  sync: WalkProgress | null;
}

/**
 * Syncs one Asana project (one month) and checks each of its reviews against Google (if a
 * checker is given) — shared by the `check-month` CLI and the dashboard's "Run now" button,
 * so both behave identically. Pass `notifier: null` to skip notifying on removals (e.g. a
 * quiet historical look-back); pass a real notifier to behave like the live daily job.
 *
 * `retireAfterRun: true` takes every review this run touched out of the daily automated
 * cycle afterward — for a historical month that isn't meant to be checked again tomorrow.
 * Pass `false` for the current month (e.g. running today's check early): those reviews
 * should stay monitored, not get silently dropped from the next 07:00 run.
 */
export async function runMonthCheck(opts: {
  projectGid: string;
  client: AsanaClient;
  asanaSettings: AsanaSettings;
  repo: ReviewRepo;
  checker: ReviewChecker | null;
  notifier: Notifier | null;
  checkDelayMs: number;
  removalRecheckDelayMs: number;
  retireAfterRun: boolean;
  onProgress?: (msg: string) => void;
  /** Called at the start, then whenever the run moves to a new review. */
  onState?: (p: RunProgress) => void;
  /** Keep checking reviews after their removal was notified (KEEP_CHECKING_REMOVED). Default: stop. */
  keepCheckingRemoved?: boolean;
  /** Polled between reviews; returning true stops the run (without retiring); removals found so far are still notified. */
  isCancelled?: () => boolean;
  /** Check only part of the month (the whole month is still synced from Asana). Default: all of it. */
  select?: RunSelection;
  /** Skip the Asana sync when this month was last synced less than this long ago. Default: always sync. */
  skipSyncIfSyncedWithinMs?: number;
}): Promise<RunMonthResult> {
  const log = opts.onProgress ?? (() => {});
  const state: RunProgress = { phase: "syncing", location: null, doneLocations: [], totalLocations: 0, reviewsDone: 0, reviewsTotal: 0, syncedMinutesAgo: null, sync: null };
  const emit = () => opts.onState?.({ ...state, doneLocations: [...state.doneLocations] });
  emit();

  // A month synced recently enough is not read from Asana again: its stored reviews are used as they are.
  let stored: ReviewRow[] | null = null;
  if (opts.skipSyncIfSyncedWithinMs && opts.skipSyncIfSyncedWithinMs > 0) {
    const last = (await opts.repo.listAsanaProjects()).find((p) => p.project_gid === opts.projectGid)?.last_synced_at;
    const age = last ? Date.now() - new Date(last).getTime() : Number.POSITIVE_INFINITY;
    if (age >= 0 && age < opts.skipSyncIfSyncedWithinMs) {
      const rows = await opts.repo.reviewsByProject(opts.projectGid);
      if (rows.length) {
        stored = rows;
        state.syncedMinutesAgo = Math.floor(age / 60_000);
        log(`Using the Asana sync from ${state.syncedMinutesAgo} minute(s) ago (${rows.length} reviews).`);
      }
    }
  }

  let sync = { tasksScanned: 0, reviewsFound: stored?.length ?? 0 };
  if (!stored) {
    log("Syncing...");
    // Asana answers in bursts, so the dashboard is told at most twice a second.
    let lastEmit = 0;
    const fresh = await syncAsana(opts.client, opts.repo, { ...opts.asanaSettings, projectGid: opts.projectGid }, {
      onProgress: (p) => {
        state.sync = p;
        const now = Date.now();
        if (now - lastEmit >= 500 || p.done === p.total) {
          lastEmit = now;
          emit();
        }
      },
    });
    log(`Synced ${fresh.reviewsFound} review tasks (${fresh.created} new).`);
    sync = fresh;
    await opts.repo.markSynced(opts.projectGid);
    stored = await opts.repo.listByAsanaTaskIds(fresh.taskIds);
  }
  const didSync = state.syncedMinutesAgo === null;

  // One location at a time, alphabetically (no-location reviews last), so progress reads top to bottom.
  const synced = stored.sort(
    (a, b) => Number(a.location === null) - Number(b.location === null) || (a.location ?? "").localeCompare(b.location ?? "") || a.id - b.id,
  );
  const touchedIds = synced.map((r) => r.id);
  const rows = selectForRun(synced, opts.select);
  if (rows.length < synced.length) log(`Checking ${rows.length} of the ${synced.length} reviews (${opts.select?.from} ${opts.select?.count}).`);

  if (!opts.checker) {
    if (opts.retireAfterRun) await opts.repo.setMonitoringActive(touchedIds, false);
    return { tasksScanned: sync.tasksScanned, reviewsFound: sync.reviewsFound, checked: 0, removed: 0, unknown: 0, checkedGoogle: false, notified: false, cancelled: false, synced: didSync };
  }

  log(`Checking ${rows.length} reviews against Google...`);
  const removed: ReviewRow[] = [];
  let unknown = 0;
  let checked = 0;
  let cancelled = false;
  await prepareChecker(opts.checker, rows);
  state.phase = "checking";
  state.sync = null;
  state.reviewsTotal = rows.length;
  state.totalLocations = new Set(rows.map((r) => r.location)).size;
  for (const [i, row] of rows.entries()) {
    if (opts.isCancelled?.()) {
      cancelled = true;
      break;
    }
    if (i > 0 && rows[i - 1].location !== row.location) state.doneLocations.push(rows[i - 1].location);
    state.location = row.location;
    state.reviewsDone = i;
    emit();
    const result = await checkWithConfirmation({ checker: opts.checker, removalRecheckDelayMs: opts.removalRecheckDelayMs }, row);
    await opts.repo.recordCheck(row, result);
    if (result.status === "REVIEW_REMOVED") removed.push(row);
    if (result.status === "UNKNOWN") unknown++;
    checked++;
    if ((i + 1) % 50 === 0) log(`...${i + 1}/${rows.length}`);
    await sleep(opts.checkDelayMs);
  }

  if (cancelled) log(`Cancelled after ${checked} of ${rows.length} reviews.`);
  else if (opts.retireAfterRun) await opts.repo.setMonitoringActive(touchedIds, false);

  // Removals are sent even when the run was cancelled. The digest covers every removal not yet
  // notified (also ones left over from a run cut short by a restart) and marks them sent, so the
  // daily run doesn't alert about them again. A failed send is recorded and retried by the daily run.
  let notified = false;
  if (removed.length && opts.notifier) {
    const sent = await notifyPending(opts.repo, opts.notifier, { stopCheckingAfterNotify: !opts.keepCheckingRemoved });
    notified = sent.sent > 0;
  }

  return {
    tasksScanned: sync.tasksScanned,
    reviewsFound: sync.reviewsFound,
    checked,
    removed: removed.length,
    unknown,
    checkedGoogle: true,
    notified,
    cancelled,
    synced: didSync,
  };
}
