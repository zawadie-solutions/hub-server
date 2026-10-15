import type { AsanaConfig } from "../config";
import type { ReviewRepo } from "../db/repo";
import { logger } from "../logger";
import type { DiscoveredReview } from "../types";
import type { AsanaClient, AsanaTask } from "./client";
import { parseRating, parseReviewerFromTitle, parseReviewerName, parseReviewText, pickGoogleReviewUrl } from "./extract";

export type AsanaSource = Pick<AsanaClient, "sections" | "sectionTasks" | "subtasks">;
export type AsanaSettings = Pick<
  AsanaConfig,
  "projectGid" | "monthIndex" | "locationIndex" | "maxDepth" | "includeCompleted" | "reviewerFromTitle"
>;

export interface WalkedTask {
  task: AsanaTask;
  /** Names from the root: [section, ancestor task, ..., this task] */
  path: string[];
  /** Who each entry of `path` is assigned to in Asana (null for the section and for unassigned tasks). */
  assignees: (string | null)[];
}

/** Runs `fn` over `items` with at most `limit` calls in flight at once. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < items.length; i = next++) results[i] = await fn(items[i]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Walk every task (and subtasks, to maxDepth) in the project, remembering the name path.
 * Expands one level at a time with bounded concurrency: a project with hundreds of
 * location-level tasks, each with its own subtasks, makes the naive one-at-a-time walk
 * take an impractically long time (and can look hung, since nothing prints until it's done).
 */
export async function walkProject(
  client: AsanaSource,
  s: AsanaSettings,
  opts: { concurrency?: number; onProgress?: (scanned: number) => void } = {},
): Promise<WalkedTask[]> {
  const concurrency = opts.concurrency ?? 8;
  const out: WalkedTask[] = [];

  const who = (t: AsanaTask) => t.assignee?.name?.trim() || null;
  const expand = async (level: WalkedTask[], depth: number): Promise<void> => {
    for (const item of level) out.push(item);
    opts.onProgress?.(out.length);
    if (depth >= s.maxDepth) return;
    const expandable = level.filter((t) => (t.task.num_subtasks ?? 0) > 0);
    if (!expandable.length) return;
    const childLevels = await mapLimit(expandable, concurrency, async ({ task, path, assignees }) =>
      (await client.subtasks(task.gid)).map((sub) => ({ task: sub, path: [...path, sub.name], assignees: [...assignees, who(sub)] })),
    );
    await expand(childLevels.flat(), depth + 1);
  };

  for (const section of await client.sections(s.projectGid)) {
    const tasks = await client.sectionTasks(section.gid);
    await expand(
      tasks.map((task) => ({ task, path: [section.name, task.name], assignees: [null, who(task)] })),
      1,
    );
  }
  return out;
}

/** Any task whose description holds a Google review link is a review task. */
export function toDiscovered(w: WalkedTask, s: AsanaSettings): DiscoveredReview | null {
  const { task, path, assignees } = w;
  if (!s.includeCompleted && task.completed) return null;
  const url = pickGoogleReviewUrl(task.notes, task.html_notes);
  if (!url) return null;
  const ancestors = path.slice(0, -1);
  const locationAt = path[s.locationIndex] && s.locationIndex < path.length - 1 ? s.locationIndex : ancestors.length - 1;
  return {
    asanaTaskId: task.gid,
    asanaTaskName: task.name,
    asanaTaskUrl: task.permalink_url ?? `https://app.asana.com/0/0/${task.gid}`,
    asanaProjectGid: s.projectGid,
    month: path[s.monthIndex] && s.monthIndex < path.length - 1 ? path[s.monthIndex] : (ancestors[0] ?? null),
    location:
      path[s.locationIndex] && s.locationIndex < path.length - 1
        ? path[s.locationIndex]
        : (ancestors[ancestors.length - 1] ?? null),
    assigneeName: assignees[assignees.length - 1] ?? null,
    locationAssigneeName: (locationAt >= 0 ? assignees[locationAt] : null) ?? null,
    reviewerName: parseReviewerName(task.notes) ?? parseReviewerFromTitle(task.name) ?? (s.reviewerFromTitle ? task.name : null),
    rating: parseRating(task.notes),
    reviewText: parseReviewText(task.notes),
    googleReviewUrl: url,
  };
}

export interface SyncSummary {
  tasksScanned: number;
  reviewsFound: number;
  created: number;
  /** asana_task_id of every review task this sync touched (created or refreshed). */
  taskIds: string[];
}

/**
 * Read everything from Asana first, then write. If Asana fails midway, an exception
 * propagates before any DB write, so existing records stay exactly as they were.
 */
export async function syncAsana(client: AsanaSource, repo: ReviewRepo, s: AsanaSettings): Promise<SyncSummary> {
  let lastLogged = 0;
  const walked = await walkProject(client, s, {
    onProgress: (scanned) => {
      if (scanned - lastLogged >= 200) {
        lastLogged = scanned;
        logger.info({ scanned }, "asana walk in progress");
      }
    },
  });
  const reviews = walked.map((w) => toDiscovered(w, s)).filter((r): r is DiscoveredReview => r !== null);
  let created = 0;
  for (const r of reviews) if (await repo.upsertDiscovered(r)) created++;
  logger.info({ tasksScanned: walked.length, reviewsFound: reviews.length, created }, "asana sync done");
  return { tasksScanned: walked.length, reviewsFound: reviews.length, created, taskIds: reviews.map((r) => r.asanaTaskId) };
}
