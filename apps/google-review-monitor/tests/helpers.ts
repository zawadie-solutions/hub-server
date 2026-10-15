import { afterAll, vi } from "vitest";
import type { AsanaSettings, AsanaSource } from "../src/asana/sync";
import { migrate } from "../src/db/db";
import { ReviewRepo } from "../src/db/repo";
import { createScratchDb } from "../src/db/scratch";
import type { CycleDeps } from "../src/monitor/cycle";
import type { CheckResult, DiscoveredReview, Notifier, ReviewChecker } from "../src/types";

/**
 * The database tests run against a real MySQL server, each in its own empty database that is
 * dropped afterwards. TEST_DATABASE_URL names the server, e.g. mysql://root:secret@127.0.0.1:3306
 * (the account needs CREATE and DROP rights; any database name in the URL is ignored).
 */
function testServerUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("Set TEST_DATABASE_URL to a MySQL server (mysql://user:password@host:3306) to run the database tests");
  return url;
}

const scratchDbs: { drop: () => Promise<void> }[] = [];
afterAll(async () => {
  for (const s of scratchDbs.splice(0)) await s.drop();
});

export async function makeRepo() {
  const scratch = await createScratchDb(testServerUrl(), "grm_test");
  scratchDbs.push(scratch);
  await migrate(scratch.db);
  return { db: scratch.db, repo: new ReviewRepo(scratch.db) };
}

export const review = (over: Partial<DiscoveredReview> = {}): DiscoveredReview => ({
  asanaTaskId: "100",
  asanaTaskName: "Review by John Smith",
  asanaTaskUrl: "https://app.asana.com/0/1/100",
  asanaProjectGid: "p1",
  location: "Location A",
  month: "October",
  assigneeName: null,
  locationAssigneeName: null,
  reviewerName: "John Smith",
  rating: 1,
  reviewText: "Terrible service, would not recommend.",
  googleReviewUrl: "https://www.google.com/maps/reviews/data=!4m8!14m7!1m6",
  ...over,
});

export function fakeChecker(...results: CheckResult[]): ReviewChecker & { calls: number } {
  const c = {
    calls: 0,
    async checkReview() {
      const r = results[Math.min(c.calls, results.length - 1)];
      c.calls++;
      return r;
    },
  };
  return c;
}

export function fakeNotifier(failTimes = 0) {
  const send = vi.fn(async () => {
    if (send.mock.calls.length <= failTimes) throw new Error("smtp down");
  });
  return { send } as Notifier & { send: typeof send };
}

export function deps(repo: ReviewRepo, checker: ReviewChecker, notifier: Notifier, sync = async () => ({})): CycleDeps {
  return {
    repo,
    checker,
    notifier,
    sync,
    removalRecheckDelayMs: 0,
    checkDelayMs: 0,
    keepCheckingRemoved: false,
  };
}

export const settings: AsanaSettings = {
  projectGid: "p1",
  monthIndex: 0,
  locationIndex: 1,
  maxDepth: 3,
  includeCompleted: true,
  reviewerFromTitle: false,
};

export function fakeAsana(
  tree: { month: string; location: string; assignee?: string; reviews: { gid: string; name: string; notes: string; assignee?: string }[] }[],
): AsanaSource {
  return {
    sections: async () => tree.map((t, i) => ({ gid: `s${i}`, name: t.month })),
    sectionTasks: async (sid) => {
      const t = tree[Number(sid.slice(1))];
      return [{ gid: `loc-${sid}`, name: t.location, num_subtasks: t.reviews.length, assignee: t.assignee ? { name: t.assignee } : null }];
    },
    subtasks: async (gid) => {
      const t = tree[Number(gid.replace("loc-s", ""))];
      return t.reviews.map(({ assignee, ...r }) => ({ ...r, assignee: assignee ? { name: assignee } : null, permalink_url: `https://app.asana.com/0/1/${r.gid}` }));
    },
  };
}
