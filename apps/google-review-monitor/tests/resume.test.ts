import { describe, expect, it } from "vitest";
import { SyncCancelled, walkProject } from "../src/asana/sync";
import { checkFailed, notCheckedSince, runOrder, selectForRun } from "../src/monitor/runMonth";
import { fakeAsana, settings } from "./helpers";

describe("continuing a stopped check", () => {
  const start = new Date("2026-11-09T10:00:00Z");
  const rows = [
    { id: 3, location: "B", last_checked_at: new Date("2026-11-09T10:05:00Z") }, // checked by the stopped run
    { id: 1, location: "A", last_checked_at: new Date("2026-11-09T10:01:00Z") }, // checked by the stopped run
    { id: 2, location: "A", last_checked_at: null }, // never checked
    { id: 4, location: "C", last_checked_at: new Date("2026-11-01T09:00:00Z") }, // checked before, not by this run
    { id: 5, location: null, last_checked_at: "2026-11-09T09:59:59.000Z" },
  ];

  it("keeps the run order: by location, no location last, then id", () => {
    expect(runOrder(rows).map((r) => r.id)).toEqual([1, 2, 3, 4, 5]);
  });

  it("checks only what the stopped run had not reached", () => {
    expect(runOrder(rows).filter(notCheckedSince(start)).map((r) => r.id)).toEqual([2, 4, 5]);
  });

  it("stays inside the stopped run's selection", () => {
    const picked = selectForRun(runOrder(rows), { from: "first", count: 2 });
    expect(picked.filter(notCheckedSince(start)).map((r) => r.id)).toEqual([2]);
  });

  it("counts a review as failed only when a check ran and could not tell", () => {
    expect(checkFailed({ status: "UNKNOWN", last_checked_at: start })).toBe(true);
    expect(checkFailed({ status: "UNKNOWN", last_checked_at: null })).toBe(false); // never checked
    expect(checkFailed({ status: "REVIEW_EXISTS", last_checked_at: start })).toBe(false);
  });
});

describe("cancelling a sync", () => {
  const asana = fakeAsana([
    { month: "October", location: "Loc 1", reviews: [{ gid: "r1", name: "R1", notes: "" }] },
    { month: "October", location: "Loc 2", reviews: [{ gid: "r2", name: "R2", notes: "" }] },
  ]);

  it("stops reading Asana once cancelled", async () => {
    let calls = 0;
    const counting = { ...asana, subtasks: async (gid: string) => (calls++, asana.subtasks(gid)) };
    let cancel = false;
    const walk = walkProject(counting, settings, { concurrency: 1, onProgress: (p) => (cancel = p.done >= 1), isCancelled: () => cancel });
    await expect(walk).rejects.toBeInstanceOf(SyncCancelled);
    expect(calls).toBe(1);
  });

  it("reads everything when not cancelled", async () => {
    const walked = await walkProject(asana, settings, { isCancelled: () => false });
    expect(walked.map((w) => w.task.gid)).toContain("r2");
  });
});
