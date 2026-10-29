import { describe, expect, it } from "vitest";
import type { AsanaClient } from "../src/asana/client";
import { syncAsana } from "../src/asana/sync";
import { type RunProgress, runMonthCheck, selectForRun } from "../src/monitor/runMonth";
import { buildRemovalMessage } from "../src/notify/message";
import { workedOnBy } from "../src/types";
import { fakeAsana, fakeChecker, fakeNotifier, makeRepo, settings } from "./helpers";

const EXISTS = { status: "REVIEW_EXISTS" } as const;
const REMOVED = { status: "REVIEW_REMOVED" } as const;
const link = (n: number) => `Reviewer: R${n}\nhttps://maps.app.goo.gl/abc${n}`;

/** Two locations, deliberately out of alphabetical order in Asana: B (2 reviews) then A (1 review). */
const tree = fakeAsana([
  { month: "October", location: "Location B", reviews: [{ gid: "b1", name: "b1", notes: link(1) }, { gid: "b2", name: "b2", notes: link(2) }] },
  { month: "October", location: "Location A", reviews: [{ gid: "a1", name: "a1", notes: link(3) }] },
]) as unknown as AsanaClient;

async function run(over: Partial<Parameters<typeof runMonthCheck>[0]> = {}) {
  const { repo } = await makeRepo();
  const notifier = fakeNotifier();
  const states: RunProgress[] = [];
  const result = await runMonthCheck({
    projectGid: "p1",
    client: tree,
    asanaSettings: settings,
    repo,
    checker: fakeChecker(EXISTS),
    notifier,
    checkDelayMs: 0,
    removalRecheckDelayMs: 0,
    retireAfterRun: true,
    onState: (p) => states.push(p),
    ...over,
  });
  return { repo, notifier, states, result };
}

describe("runMonthCheck progress and cancel", () => {
  it("reports syncing, then each location in alphabetical order with what is already done", async () => {
    const { states, result } = await run();
    expect(result).toMatchObject({ checked: 3, cancelled: false });
    expect(states[0]).toMatchObject({ phase: "syncing", location: null });
    const checking = states.filter((s) => s.phase === "checking");
    expect(checking.map((s) => [s.location, s.reviewsDone, s.doneLocations])).toEqual([
      ["Location A", 0, []],
      ["Location B", 1, ["Location A"]],
      ["Location B", 2, ["Location A"]],
    ]);
    expect(checking[0]).toMatchObject({ totalLocations: 2, reviewsTotal: 3 });
  });

  it("cancel stops before the next review, keeps what was checked, does not retire, but still notifies what it found", async () => {
    let seen = 0;
    const { repo, notifier, result } = await run({
      checker: fakeChecker(REMOVED),
      isCancelled: () => seen++ >= 1, // allow one review, then cancel
    });
    expect(result).toMatchObject({ checked: 1, removed: 1, cancelled: true, notified: true });
    expect(notifier.send).toHaveBeenCalledTimes(1);
    const rows = await repo.all();
    const removed = rows.filter((r) => r.status === "REVIEW_REMOVED");
    expect(removed.length).toBe(1);
    expect(removed[0].notification_sent).toBeTruthy();
    expect(rows.filter((r) => r.status !== "REVIEW_REMOVED").every((r) => r.monitoring_active)).toBe(true);
  });

  it("without a cancel, a finished run still retires and notifies as before", async () => {
    const { repo, notifier, result } = await run({ checker: fakeChecker(REMOVED) });
    expect(result).toMatchObject({ checked: 3, removed: 3, cancelled: false, notified: true });
    expect(notifier.send).toHaveBeenCalledTimes(1);
    expect((await repo.all()).every((r) => !r.monitoring_active && r.notification_sent)).toBe(true);
  });

  it("a cancelled run with nothing removed sends nothing", async () => {
    const { notifier, result } = await run({ isCancelled: () => true });
    expect(result).toMatchObject({ checked: 0, cancelled: true, notified: false });
    expect(notifier.send).not.toHaveBeenCalled();
  });
});

describe("who is working on a dispute (from Asana)", () => {
  const people = fakeAsana([
    {
      month: "October",
      location: "Location A",
      assignee: "Lena Fischer",
      reviews: [
        { gid: "a1", name: "a1", notes: link(1), assignee: "Priya Nair" },
        { gid: "a2", name: "a2", notes: link(2) },
      ],
    },
    { month: "October", location: "Location B", reviews: [{ gid: "b1", name: "b1", notes: link(3) }] },
  ]) as unknown as AsanaClient;

  it("sync stores the dispute's assignee and the location's assignee, and a re-sync picks up a change", async () => {
    const { repo } = await makeRepo();
    await syncAsana(people, repo, settings);
    const by = new Map((await repo.all()).map((r) => [r.asana_task_id, r]));
    expect([by.get("a1")?.assignee_name, by.get("a1")?.location_assignee_name]).toEqual(["Priya Nair", "Lena Fischer"]);
    expect([by.get("a2")?.assignee_name, by.get("a2")?.location_assignee_name]).toEqual([null, "Lena Fischer"]);
    expect([by.get("b1")?.assignee_name, by.get("b1")?.location_assignee_name]).toEqual([null, null]);
    expect([workedOnBy(by.get("a1")!), workedOnBy(by.get("a2")!), workedOnBy(by.get("b1")!)]).toEqual(["Priya Nair", "Lena Fischer", null]);

    const reassigned = fakeAsana([{ month: "October", location: "Location A", assignee: "Omar Haddad", reviews: [{ gid: "a2", name: "a2", notes: link(2) }] }]) as unknown as AsanaClient;
    await syncAsana(reassigned, repo, settings);
    expect((await repo.all()).find((r) => r.asana_task_id === "a2")?.location_assignee_name).toBe("Omar Haddad");
  });

  it("the removal alert shows only location, reviewer and Google link: no agent, rating or task link", async () => {
    const { repo } = await makeRepo();
    await syncAsana(people, repo, settings);
    const msg = buildRemovalMessage(await repo.all());
    expect(msg.text).toContain("Location: Location A\nReviewer: R1\nGoogle review: https://maps.app.goo.gl/abc1");
    for (const body of [msg.text, msg.html]) {
      for (const gone of ["Worked on by", "Priya Nair", "Lena Fischer", "Rating", "Asana task", "app.asana.com"]) expect(body).not.toContain(gone);
    }
  });
});

describe('reviews already tagged "Successfully removed" in Asana', () => {
  const tagged = fakeAsana([
    {
      month: "October",
      location: "Location A",
      reviews: [
        { gid: "t1", name: "t1", notes: link(1), tags: ["Successfully removed"] },
        { gid: "t2", name: "t2", notes: link(2), tags: ["Not removed"] },
        { gid: "t3", name: "t3", notes: link(3) },
      ],
    },
  ]) as unknown as AsanaClient;

  it("sync records the tag, and a re-sync picks up a newly added one", async () => {
    const { repo } = await makeRepo();
    await syncAsana(tagged, repo, settings);
    const by = new Map((await repo.all()).map((r) => [r.asana_task_id, !!r.asana_tagged_removed]));
    expect([by.get("t1"), by.get("t2"), by.get("t3")]).toEqual([true, false, false]);

    const later = fakeAsana([{ month: "October", location: "Location A", reviews: [{ gid: "t3", name: "t3", notes: link(3), tags: ["successfully removed "] }] }]) as unknown as AsanaClient;
    await syncAsana(later, repo, settings);
    expect(!!(await repo.all()).find((r) => r.asana_task_id === "t3")?.asana_tagged_removed).toBe(true);
  });

  it("are never sent in a removal alert, even when found removed", async () => {
    const { repo, notifier, result } = await run({ client: tagged, checker: fakeChecker(REMOVED) });
    expect(result).toMatchObject({ removed: 3, notified: true });
    expect(notifier.send).toHaveBeenCalledTimes(1);
    const sent = (notifier.send.mock.calls[0] as unknown as [{ text: string }])[0].text;
    expect(sent).toContain("Reviewer: R2");
    expect(sent).toContain("Reviewer: R3");
    expect(sent).not.toContain("Reviewer: R1");
    expect((await repo.pendingNotifications()).length).toBe(0);
  });

  it("a run where every removal is already tagged sends nothing", async () => {
    const allTagged = fakeAsana([{ month: "October", location: "Location A", reviews: [{ gid: "t1", name: "t1", notes: link(1), tags: ["Successfully removed"] }] }]) as unknown as AsanaClient;
    const { notifier, result } = await run({ client: allTagged, checker: fakeChecker(REMOVED) });
    expect(result).toMatchObject({ removed: 1, notified: false });
    expect(notifier.send).not.toHaveBeenCalled();
  });
});

describe("run options: checking only part of the month", () => {
  const rows = [
    { id: 1, location: "A" }, { id: 2, location: "A" }, { id: 3, location: "A" },
    { id: 4, location: "B" }, { id: 5, location: "B" },
    { id: 6, location: "C" },
    { id: 7, location: null },
  ];
  const ids = (r: { id: number }[]) => r.map((x) => x.id);

  it("no selection, or a number at least as large as the month, checks everything", () => {
    expect(selectForRun(rows)).toBe(rows);
    expect(selectForRun(rows, { from: "first", count: 7 })).toBe(rows);
    expect(selectForRun(rows, { from: "last", count: 99 })).toBe(rows);
  });

  it("first N takes from the top and finishes the location it lands in", () => {
    expect(ids(selectForRun(rows, { from: "first", count: 1 }))).toEqual([1, 2, 3]); // A is not split
    expect(ids(selectForRun(rows, { from: "first", count: 3 }))).toEqual([1, 2, 3]); // lands exactly on a boundary
    expect(ids(selectForRun(rows, { from: "first", count: 4 }))).toEqual([1, 2, 3, 4, 5]);
  });

  it("last N takes from the bottom, keeps run order, and finishes the location it lands in", () => {
    expect(ids(selectForRun(rows, { from: "last", count: 1 }))).toEqual([7]);
    expect(ids(selectForRun(rows, { from: "last", count: 2 }))).toEqual([6, 7]);
    expect(ids(selectForRun(rows, { from: "last", count: 3 }))).toEqual([4, 5, 6, 7]); // B is not split
  });

  it("a limited run syncs the whole month but checks only the chosen reviews", async () => {
    const { repo, result, states } = await run({ select: { from: "first", count: 1 } });
    expect(result).toMatchObject({ reviewsFound: 3, checked: 1, cancelled: false }); // Location A has one review
    const all = await repo.all();
    expect(all.length).toBe(3);
    expect(all.filter((r) => r.last_checked_at !== null).map((r) => r.location)).toEqual(["Location A"]);
    expect(states.filter((s) => s.phase === "checking").at(-1)).toMatchObject({ reviewsTotal: 1, totalLocations: 1 });
  });
});

describe("skipping the Asana sync when the month was synced recently", () => {
  const base = { projectGid: "p1", asanaSettings: settings, notifier: null, checkDelayMs: 0, removalRecheckDelayMs: 0, retireAfterRun: false };
  const asanaDown = { sections: async () => { throw new Error("Asana must not be read"); } } as unknown as AsanaClient;

  it("a fresh sync is reused, an old one is not, and the last-synced time only moves when Asana was read", async () => {
    const { repo, db } = await makeRepo();
    await repo.noteAsanaProjectSeen("p1", "October");
    const first = await runMonthCheck({ ...base, client: tree, repo, checker: fakeChecker(EXISTS), skipSyncIfSyncedWithinMs: 3_600_000 });
    expect(first).toMatchObject({ synced: true, checked: 3 }); // never synced before, so it syncs
    const syncedAt = (await repo.listAsanaProjects())[0].last_synced_at;
    expect(syncedAt).not.toBeNull();

    const states: RunProgress[] = [];
    const second = await runMonthCheck({ ...base, client: asanaDown, repo, checker: fakeChecker(EXISTS), skipSyncIfSyncedWithinMs: 3_600_000, onState: (p) => states.push(p) });
    expect(second).toMatchObject({ synced: false, checked: 3, reviewsFound: 3 });
    expect(states.at(-1)?.syncedMinutesAgo).toBe(0);
    await repo.finishAsanaRun("p1", { ok: true, reviewCount: 3, synced: false });
    expect((await repo.listAsanaProjects())[0].last_synced_at).toEqual(syncedAt);

    // older than the window, or no window given: Asana is read again
    await db.query("UPDATE asana_month_projects SET last_synced_at = now(3) - INTERVAL 2 HOUR WHERE project_gid = 'p1'");
    await expect(runMonthCheck({ ...base, client: asanaDown, repo, checker: fakeChecker(EXISTS), skipSyncIfSyncedWithinMs: 3_600_000 })).rejects.toThrow("Asana must not be read");
    await repo.markSynced("p1");
    await expect(runMonthCheck({ ...base, client: asanaDown, repo, checker: fakeChecker(EXISTS) })).rejects.toThrow("Asana must not be read");
  });
});
