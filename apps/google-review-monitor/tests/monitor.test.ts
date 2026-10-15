import { describe, expect, it } from "vitest";
import { syncAsana } from "../src/asana/sync";
import { BusinessProfileChecker } from "../src/google/businessProfileChecker";
import { runCycle } from "../src/monitor/cycle";
import { SlackDmNotifier } from "../src/notify/slack";
import { deps, fakeAsana, fakeChecker, fakeNotifier, makeRepo, review, settings } from "./helpers";

const EXISTS = { status: "REVIEW_EXISTS" } as const;
const REMOVED = { status: "REVIEW_REMOVED" } as const;
const UNKNOWN = { status: "UNKNOWN", reason: "google down" } as const;

async function setup(checker: ReturnType<typeof fakeChecker>, notifier = fakeNotifier()) {
  const { repo } = await makeRepo();
  await repo.upsertDiscovered(review());
  return { repo, notifier, d: deps(repo, checker, notifier) };
}

describe("monitor cycle", () => {
  it("existing review -> REVIEW_EXISTS, no notification", async () => {
    const { repo, notifier, d } = await setup(fakeChecker(EXISTS));
    await runCycle(d);
    expect((await repo.all())[0].status).toBe("REVIEW_EXISTS");
    expect(notifier.send).not.toHaveBeenCalled();
  });

  it("removed review -> REVIEW_REMOVED, exactly one notification, then stops being checked", async () => {
    const { repo, notifier, d } = await setup(fakeChecker(REMOVED));
    await runCycle(d);
    const row = (await repo.all())[0];
    expect(row.status).toBe("REVIEW_REMOVED");
    expect(row.notification_sent).toBe(true);
    expect(row.removed_at).not.toBeNull();
    expect(row.monitoring_active).toBe(false);
    expect(notifier.send).toHaveBeenCalledTimes(1);
  });

  it("Google unavailable -> UNKNOWN, no notification", async () => {
    const { repo, notifier, d } = await setup(fakeChecker(UNKNOWN));
    await runCycle(d);
    const row = (await repo.all())[0];
    expect(row.status).toBe("UNKNOWN");
    expect(row.last_error).toBe("google down");
    expect(notifier.send).not.toHaveBeenCalled();
  });

  it("a checker that throws is treated as UNKNOWN", async () => {
    const { repo, notifier, d } = await setup(fakeChecker(EXISTS));
    d.checker = { checkReview: async () => { throw new Error("boom"); } };
    await runCycle(d);
    expect((await repo.all())[0].status).toBe("UNKNOWN");
    expect(notifier.send).not.toHaveBeenCalled();
  });

  it("removal that is not confirmed by the re-check is not accepted", async () => {
    const { repo, notifier, d } = await setup(fakeChecker(REMOVED, UNKNOWN));
    await runCycle(d);
    expect((await repo.all())[0].status).toBe("UNKNOWN");
    expect(notifier.send).not.toHaveBeenCalled();
  });

  it("running the same removed review repeatedly sends only one notification", async () => {
    const { notifier, d } = await setup(fakeChecker(REMOVED));
    d.keepCheckingRemoved = true; // even if still being checked
    await runCycle(d);
    await runCycle(d);
    await runCycle(d);
    expect(notifier.send).toHaveBeenCalledTimes(1);
  });

  it("notification failure keeps notification_sent=false and retries next run", async () => {
    const { repo, notifier, d } = await setup(fakeChecker(REMOVED), fakeNotifier(1));
    await runCycle(d);
    let row = (await repo.all())[0];
    expect(row.notification_sent).toBe(false);
    expect(row.last_notification_error).toBe("smtp down");
    await runCycle(d);
    row = (await repo.all())[0];
    expect(row.notification_sent).toBe(true);
    expect(notifier.send).toHaveBeenCalledTimes(2);
  });

  it("a reappearing review resets notification state so a later removal notifies again", async () => {
    const { repo, notifier, d } = await setup(fakeChecker(REMOVED, REMOVED, EXISTS, REMOVED, REMOVED));
    d.keepCheckingRemoved = true;
    await runCycle(d); // removed + notify
    await runCycle(d); // exists again
    expect((await repo.all())[0].notification_sent).toBe(false);
    await runCycle(d); // removed again
    expect(notifier.send).toHaveBeenCalledTimes(2);
  });

  it("records check history", async () => {
    const { repo, d } = await setup(fakeChecker(EXISTS));
    await runCycle(d);
    await runCycle(d);
    const id = (await repo.all())[0].id;
    expect(await repo.history(id)).toHaveLength(2);
  });
});

describe("asana sync", () => {
  const notes = (u: string) => `Reviewer: Mary Jones\nRating: 2 stars\n${u}`;
  const url = "https://www.google.com/maps/reviews/data=!4m8";

  it("new Asana task is discovered and added to monitoring", async () => {
    const { repo } = await makeRepo();
    const tree = [{ month: "October", location: "Location A", reviews: [{ gid: "1", name: "r1", notes: notes(url) }] }];
    expect((await syncAsana(fakeAsana(tree), repo, settings)).created).toBe(1);
    tree[0].reviews.push({ gid: "2", name: "r2", notes: notes(url + "2") });
    tree[0].reviews.push({ gid: "3", name: "no link", notes: "nothing here" });
    expect((await syncAsana(fakeAsana(tree), repo, settings)).created).toBe(1);
    const rows = await repo.all();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ month: "October", location: "Location A", reviewer_name: "Mary Jones", rating: 2 });
  });

  it("Asana failure leaves existing records intact", async () => {
    const { repo } = await makeRepo();
    await repo.upsertDiscovered(review());
    const broken = { ...fakeAsana([]), sections: async () => { throw new Error("asana 500"); } };
    await expect(syncAsana(broken, repo, settings)).rejects.toThrow("asana 500");
    expect(await repo.all()).toHaveLength(1);

    // and the cycle survives it: check + notify still run
    const d = deps(repo, fakeChecker(EXISTS), fakeNotifier(), broken.sections as never);
    await runCycle(d);
    expect((await repo.all())[0].status).toBe("REVIEW_EXISTS");
  });
});

describe("BusinessProfileChecker", () => {
  const base = review();
  const input = { id: 1, googleReviewUrl: base.googleReviewUrl, location: "Location A", reviewerName: "John Smith", rating: 1 };
  const auth = { getAccessToken: async () => "t" };
  const locationMap = { "location a": "accounts/1/locations/2" };
  const listing = (names: string[], total = names.length) =>
    async () => new Response(JSON.stringify({ reviews: names.map((n) => ({ reviewer: { displayName: n } })), totalReviewCount: total }));
  const checker = (fetchImpl: typeof fetch) => new BusinessProfileChecker({ auth, locationMap, fetchImpl, cacheMs: 0 });

  it("reviewer present -> EXISTS", async () => {
    expect(await checker(listing(["Mary", "john  SMITH"]) as never).checkReview(input)).toEqual(EXISTS);
  });
  it("complete listing without reviewer -> REMOVED", async () => {
    expect(await checker(listing(["Mary"]) as never).checkReview(input)).toEqual(REMOVED);
  });
  it("HTTP error / rate limit -> UNKNOWN", async () => {
    for (const status of [401, 403, 429, 500]) {
      const r = await checker((async () => new Response("", { status })) as never).checkReview(input);
      expect(r.status).toBe("UNKNOWN");
    }
  });
  it("network failure -> UNKNOWN", async () => {
    const r = await checker((async () => { throw new Error("ETIMEDOUT"); }) as never).checkReview(input);
    expect(r.status).toBe("UNKNOWN");
  });
  it("incomplete listing -> UNKNOWN (never REMOVED)", async () => {
    expect((await checker(listing(["Mary"], 5) as never).checkReview(input)).status).toBe("UNKNOWN");
  });
  it("invalid URL, unknown location, missing reviewer -> UNKNOWN", async () => {
    const c = checker(listing([]) as never);
    expect((await c.checkReview({ ...input, googleReviewUrl: "not a url" })).status).toBe("UNKNOWN");
    expect((await c.checkReview({ ...input, googleReviewUrl: "https://evil.example/maps" })).status).toBe("UNKNOWN");
    expect((await c.checkReview({ ...input, location: "Nowhere" })).status).toBe("UNKNOWN");
    expect((await c.checkReview({ ...input, reviewerName: null })).status).toBe("UNKNOWN");
  });
});

describe("SlackDmNotifier", () => {
  const msg = { subject: "Google Review Removed", text: "Location: A\nReviewer: John Smith", html: "" };
  const creds = { botToken: "xoxb-test", recipientUserIds: ["U123"] };

  it("posts to chat.postMessage with the recipient as channel and subject+text combined", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen = { url: String(url), init };
      return new Response(JSON.stringify({ ok: true }));
    }) as typeof fetch;
    await new SlackDmNotifier(creds, fetchImpl).send(msg);
    expect(seen?.url).toBe("https://slack.com/api/chat.postMessage");
    expect(seen?.init.headers).toMatchObject({ Authorization: "Bearer xoxb-test" });
    const body = JSON.parse(seen?.init.body as string);
    expect(body.channel).toBe("U123");
    expect(body.text).toContain(msg.subject);
    expect(body.text).toContain("John Smith");
  });

  it("HTTP error -> throws", async () => {
    const fetchImpl = (async () => new Response("", { status: 500 })) as typeof fetch;
    await expect(new SlackDmNotifier(creds, fetchImpl).send(msg)).rejects.toThrow("HTTP 500");
  });

  it("Slack API error (ok: false) -> throws", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ ok: false, error: "channel_not_found" }))) as typeof fetch;
    await expect(new SlackDmNotifier(creds, fetchImpl).send(msg)).rejects.toThrow("channel_not_found");
  });

  it("sends an individual DM to every recipient", async () => {
    const seenChannels: string[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      seenChannels.push(JSON.parse(init.body as string).channel);
      return new Response(JSON.stringify({ ok: true }));
    }) as typeof fetch;
    await new SlackDmNotifier({ botToken: "xoxb-test", recipientUserIds: ["U1", "U2"] }, fetchImpl).send(msg);
    expect(seenChannels).toEqual(["U1", "U2"]);
  });

  it("one recipient failing still attempts the rest, then throws naming only the failure(s)", async () => {
    const seenChannels: string[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      const channel = JSON.parse(init.body as string).channel;
      seenChannels.push(channel);
      return new Response(JSON.stringify(channel === "U1" ? { ok: false, error: "not_in_channel" } : { ok: true }));
    }) as typeof fetch;
    const n = new SlackDmNotifier({ botToken: "xoxb-test", recipientUserIds: ["U1", "U2"] }, fetchImpl);
    const err = await n.send(msg).then(
      () => null,
      (e: Error) => e,
    );
    expect(seenChannels).toEqual(["U1", "U2"]); // U2 was still attempted after U1 failed
    expect(err?.message).toContain("U1: not_in_channel");
    expect(err?.message).not.toContain("U2");
  });
});

describe("month scoping (for the dashboard's month filter / check-month)", () => {
  async function twoMonths() {
    const { repo } = await makeRepo();
    const sep = await repo.upsertDiscovered(
      review({ asanaTaskId: "s1", asanaProjectGid: "proj-sep", month: "September", reviewerName: "Sep Reviewer" }),
    );
    const oct = await repo.upsertDiscovered(
      review({ asanaTaskId: "o1", asanaProjectGid: "proj-oct", month: "October", reviewerName: "Oct Reviewer" }),
    );
    expect([sep, oct]).toEqual([true, true]);
    const [sepRow, octRow] = await repo.all();
    await repo.recordCheck(sepRow, REMOVED);
    await repo.recordCheck(octRow, REMOVED);
    return { repo, sepRow, octRow };
  }

  it("distinctProjects lists every project present, with its display month", async () => {
    const { repo } = await twoMonths();
    const projects = await repo.distinctProjects();
    expect(new Set(projects.map((p) => p.projectGid))).toEqual(new Set(["proj-sep", "proj-oct"]));
    expect(projects.find((p) => p.projectGid === "proj-sep")?.month).toBe("September");
    expect(projects.find((p) => p.projectGid === "proj-sep")?.count).toBe(1);
  });

  it("summary/removedReviews/recentActivity scope to the given project only", async () => {
    const { repo } = await twoMonths();
    expect((await repo.summary("proj-sep")).removed).toBe(1);
    expect((await repo.summary("proj-sep")).monitored).toBe(1);
    expect((await repo.removedReviews({ projectGid: "proj-sep" })).map((r) => r.reviewer_name)).toEqual(["Sep Reviewer"]);
    expect((await repo.recentActivity({ projectGid: "proj-oct" }))[0].removedDetails[0].reviewerName).toBe("Oct Reviewer");
    // no project filter -> sees both
    expect((await repo.summary()).monitored).toBe(2);
    expect((await repo.removedReviews({})).length).toBe(2);
  });

  it("locations/reviewsByLocation scope to the given project and location", async () => {
    const { repo } = await twoMonths();
    await repo.upsertDiscovered(review({ asanaTaskId: "o2", asanaProjectGid: "proj-oct", location: "Location B", reviewerName: "B Reviewer" }));
    await repo.upsertDiscovered(review({ asanaTaskId: "o3", asanaProjectGid: "proj-oct", location: null, reviewerName: "Nowhere" }));
    const locs = await repo.locations("proj-oct");
    expect(locs.find((l) => l.location === "Location B")?.count).toBe(1);
    expect(locs.find((l) => l.location === null)?.count).toBe(1);
    expect((await repo.locations("proj-sep")).some((l) => l.location === "Location B")).toBe(false);
    expect((await repo.reviewsByLocation({ projectGid: "proj-oct", location: "Location B" })).map((r) => r.reviewer_name)).toEqual(["B Reviewer"]);
    expect((await repo.reviewsByLocation({ projectGid: "proj-oct", location: null })).map((r) => r.reviewer_name)).toEqual(["Nowhere"]);
    expect(await repo.reviewsByLocation({ projectGid: "proj-sep", location: "Location B" })).toEqual([]);
  });

  it("clearInterruptedRuns frees projects left 'running' by a restart, and only those", async () => {
    const { repo } = await makeRepo();
    await repo.tryStartAsanaRun("proj-stuck", "Stuck");
    await repo.tryStartAsanaRun("proj-done", "Done");
    await repo.finishAsanaRun("proj-done", { ok: true, reviewCount: 3 });
    expect(await repo.clearInterruptedRuns()).toBe(1);
    const byGid = new Map((await repo.listAsanaProjects()).map((p) => [p.project_gid, p]));
    expect(byGid.get("proj-stuck")?.run_status).toBe("failed");
    expect(byGid.get("proj-stuck")?.last_run_error).toContain("interrupted");
    expect(byGid.get("proj-done")?.run_status).toBe("done");
    expect(await repo.tryStartAsanaRun("proj-stuck", "Stuck")).toBe(true);
    expect(await repo.clearInterruptedRuns()).toBe(1);
    expect(await repo.clearInterruptedRuns()).toBe(0);
  });

  it("listByAsanaTaskIds finds only the requested tasks, and setMonitoringActive retires them", async () => {
    const { repo, sepRow, octRow } = await twoMonths();
    const found = await repo.listByAsanaTaskIds(["s1"]);
    expect(found.map((r) => r.id)).toEqual([sepRow.id]);
    expect(await repo.listByAsanaTaskIds([])).toEqual([]);

    await repo.setMonitoringActive([sepRow.id, octRow.id], false);
    expect(await repo.listToCheck()).toEqual([]);
  });
});

describe("asana_month_projects run tracking (for the dashboard's Run now button)", () => {
  it("a second run cannot start while one is in progress for the same project", async () => {
    const { repo } = await makeRepo();
    expect(await repo.tryStartAsanaRun("p1", "October 2026")).toBe(true);
    expect(await repo.tryStartAsanaRun("p1", "October 2026")).toBe(false); // already running
    expect(await repo.tryStartAsanaRun("p2", "September 2026")).toBe(true); // different project, unaffected

    const [p1] = (await repo.listAsanaProjects()).filter((p) => p.project_gid === "p1");
    expect(p1.run_status).toBe("running");
  });

  it("finishAsanaRun records success or failure, then a new run can start again", async () => {
    const { repo } = await makeRepo();
    await repo.tryStartAsanaRun("p1", "October 2026");
    await repo.finishAsanaRun("p1", { ok: true, reviewCount: 42 });

    let [p1] = await repo.listAsanaProjects();
    expect(p1.run_status).toBe("done");
    expect(p1.last_review_count).toBe(42);
    expect(p1.last_synced_at).toBeTruthy();

    expect(await repo.tryStartAsanaRun("p1", "October 2026")).toBe(true); // not running anymore -> can start

    await repo.finishAsanaRun("p1", { ok: false, error: "google down" });
    [p1] = await repo.listAsanaProjects();
    expect(p1.run_status).toBe("failed");
    expect(p1.last_run_error).toBe("google down");
  });

  it("a stuck 'running' row older than staleMinutes is reclaimed", async () => {
    const { repo, db } = await makeRepo();
    await repo.tryStartAsanaRun("p1", "October 2026");
    await db.query("UPDATE asana_month_projects SET updated_at = now(3) - INTERVAL 1 HOUR WHERE project_gid = 'p1'");

    expect(await repo.tryStartAsanaRun("p1", "October 2026", 20)).toBe(true); // 1h > 20min stale threshold
  });
});
