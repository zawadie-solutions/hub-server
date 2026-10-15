import { describe, expect, it } from "vitest";
import { DataForSeoChecker } from "../src/google/dataForSeoChecker";

const EXISTS = { status: "REVIEW_EXISTS" } as const;
const REMOVED = { status: "REVIEW_REMOVED" } as const;

const REVIEW_ID = "ChdDSUhNMG9nS0VJQ0FnSUNNcS1pbnBRRRAB";
const CID = "420590211543183178"; // 0x5d63c91ab09af4a
const CID2 = "9755366995660373589";
const shortFor = (cid: string) => `https://maps.app.goo.gl/${cid}`;
const longFor = (cid: string, reviewId = REVIEW_ID) =>
  `https://www.google.com/maps/reviews/data=!4m8!14m7!1m6!2m5!1s${reviewId}!2m1!1s0x0:0x${BigInt(cid).toString(16)}!3m1!1s2@1:x?entry=tts`;

describe("DataForSeoChecker", () => {
  const input = { id: 1, googleReviewUrl: shortFor(CID), location: "A & B Managed Reputation Lite (5)", reviewerName: "Susan Gaynor", rating: 1 };
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `r${i}`);

  /**
   * Fake DataForSEO + Google short links. `places` maps a CID to its listing; each task is
   * reported "in queue" `queuedPolls` times before it is ready.
   */
  function dfs(places: Record<string, { ids: string[]; total: number; cidInResult?: string }>, opts: { queuedPolls?: number; postStatus?: number; http?: number } = {}) {
    const seen = { posts: [] as Record<string, unknown>[][], gets: 0, auth: "" };
    const tasks = new Map<string, { cid: string; depth: number; polls: number }>();
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.startsWith("https://maps.app.goo.gl/")) return new Response(null, { status: 302, headers: { location: longFor(u.split("/").pop() as string) } });
      if (opts.http) return new Response(JSON.stringify({ status_code: 40100, status_message: "nope" }), { status: opts.http });
      seen.auth = (init?.headers as Record<string, string>).Authorization;
      if (u.endsWith("/task_post")) {
        const body = JSON.parse(init?.body as string) as { cid: string; depth: number }[];
        seen.posts.push(body);
        return new Response(
          JSON.stringify({
            status_code: 20000,
            status_message: "Ok.",
            cost: 0.03,
            tasks: body.map((t) => {
              const id = `task-${tasks.size}`;
              tasks.set(id, { cid: t.cid, depth: t.depth, polls: 0 });
              return { id, status_code: opts.postStatus ?? 20100, status_message: opts.postStatus ? "Payment Required." : "Task Created.", data: t };
            }),
          }),
        );
      }
      const id = u.split("/task_get/")[1];
      const t = tasks.get(id);
      if (!t) throw new Error(`unexpected request ${u}`);
      seen.gets++;
      if (t.polls++ < (opts.queuedPolls ?? 0)) return new Response(JSON.stringify({ status_code: 20000, status_message: "Ok.", tasks: [{ id, status_code: 40602, status_message: "Task In Queue." }] }));
      const p = places[t.cid];
      const result = p ? [{ title: "A & B", cid: p.cidInResult ?? t.cid, reviews_count: p.total, items_count: Math.min(p.ids.length, t.depth), items: p.ids.slice(0, t.depth).map((r) => ({ review_id: r, profile_name: `Author ${r}`, rating: { value: 1 }, timestamp: "2024-05-05 14:09:32 +00:00" })) }] : null;
      return new Response(JSON.stringify({ status_code: 20000, status_message: "Ok.", tasks: [{ id, status_code: 20000, status_message: "Ok.", result }] }));
    }) as typeof fetch;
    const checker = (over: { maxReviews?: number; priority?: boolean } = {}) =>
      new DataForSeoChecker({ login: "me@example.com", password: "pw", maxReviews: 200, priority: false, pollMs: 0, fetchImpl, ...over });
    return { seen, checker };
  }

  it("review ID in the listing -> EXISTS, asking for the place by CID, newest first", async () => {
    const d = dfs({ [CID]: { ids: ["other", REVIEW_ID], total: 284 } }, { queuedPolls: 2 });
    expect(await d.checker().checkReview(input)).toEqual(EXISTS);
    expect(d.seen.auth).toBe(`Basic ${Buffer.from("me@example.com:pw").toString("base64")}`);
    expect(d.seen.posts[0][0]).toMatchObject({ cid: CID, depth: 200, sort_by: "newest", priority: 1, location_code: 2840, language_code: "en" });
    expect(d.seen.gets).toBe(3); // two "in queue", then ready
  });

  it("accepts the dashboard's ready-made base64 token pasted as the login", async () => {
    const token = Buffer.from("me@example.com:pw").toString("base64");
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      if (String(url).startsWith("https://maps.app.goo.gl/")) return new Response(null, { status: 302, headers: { location: longFor(CID) } });
      expect((init?.headers as Record<string, string>).Authorization).toBe(`Basic ${token}`);
      return new Response(JSON.stringify({ status_code: 40100, status_message: "stop here" }), { status: 401 });
    }) as typeof fetch;
    const r = await new DataForSeoChecker({ login: token, password: "pw", maxReviews: 200, priority: false, pollMs: 0, fetchImpl }).checkReview(input);
    expect(r.status).toBe("UNKNOWN");
  });

  it("prepare posts every place of the run in one request, and each is listed once", async () => {
    const d = dfs({ [CID]: { ids: [REVIEW_ID], total: 1 }, [CID2]: { ids: [REVIEW_ID], total: 1 } });
    const c = d.checker({ priority: true });
    const other = { ...input, id: 2, googleReviewUrl: shortFor(CID2) };
    await c.prepare([input, { ...input, id: 3 }, other]);
    expect(d.seen.posts.length).toBe(1);
    expect(d.seen.posts[0].map((t) => [t.cid, t.priority])).toEqual([[CID, 2], [CID2, 2]]);
    expect(await c.checkReview(input)).toEqual(EXISTS);
    expect(await c.checkReview({ ...input, id: 3 })).toEqual(EXISTS);
    expect(await c.checkReview(other)).toEqual(EXISTS);
    expect(d.seen.posts.length).toBe(1);
    expect(d.seen.gets).toBe(2);
  });

  it("complete listing without the review -> REMOVED, and the confirmation lists the place again on the priority queue", async () => {
    const d = dfs({ [CID]: { ids: ids(100), total: 100 } });
    const c = d.checker();
    expect(await c.checkReview(input)).toEqual(REMOVED);
    expect(await c.checkReview(input)).toEqual(REMOVED);
    expect(d.seen.posts.map((p) => p[0].priority)).toEqual([1, 2]);
  });

  it("listing cut off at the cap -> UNKNOWN (never REMOVED)", async () => {
    const r = await dfs({ [CID]: { ids: ids(300), total: 300 } }).checker({ maxReviews: 50 }).checkReview(input);
    expect(r.status).toBe("UNKNOWN");
  });

  it("maxReviews 0 asks for DataForSEO's limit of 4,490", async () => {
    const d = dfs({ [CID]: { ids: [REVIEW_ID], total: 1 } });
    await d.checker({ maxReviews: 0 }).checkReview(input);
    expect(d.seen.posts[0][0].depth).toBe(4490);
  });

  it("short listing, no reviews, a different place, a refused task or an HTTP error -> UNKNOWN", async () => {
    expect((await dfs({ [CID]: { ids: ids(80), total: 100 } }).checker().checkReview(input)).status).toBe("UNKNOWN");
    expect((await dfs({}).checker().checkReview(input)).status).toBe("UNKNOWN");
    expect((await dfs({ [CID]: { ids: [REVIEW_ID], total: 1, cidInResult: "999" } }).checker().checkReview(input)).status).toBe("UNKNOWN");
    expect((await dfs({ [CID]: { ids: [REVIEW_ID], total: 1 } }, { postStatus: 40200 }).checker().checkReview(input)).status).toBe("UNKNOWN");
    expect((await dfs({}, { http: 401 }).checker().checkReview(input)).status).toBe("UNKNOWN");
    expect((await dfs({}).checker().checkReview({ ...input, googleReviewUrl: "https://example.com/x" })).status).toBe("UNKNOWN");
  });

  it("placeReviews returns the place and its newest reviews for display, via a small priority task", async () => {
    const d = dfs({ [CID]: { ids: [REVIEW_ID, "r2"], total: 284 } });
    const r = await d.checker().placeReviews(input.location, [shortFor(CID)]);
    expect(r).toMatchObject({ name: "A & B", totalReviews: 284, confirmed: true });
    expect(r?.reviews[0]).toMatchObject({ id: REVIEW_ID, author: `Author ${REVIEW_ID}`, rating: 1, publishedAt: "2024-05-05T14:09:32+00:00" });
    expect(d.seen.posts[0][0]).toMatchObject({ depth: 20, priority: 2 });
    expect(await d.checker().placeReviews(input.location, [])).toBeNull();
  });
});
