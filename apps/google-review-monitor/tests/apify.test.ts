import { describe, expect, it } from "vitest";
import { ApifyChecker } from "../src/google/apifyChecker";

const EXISTS = { status: "REVIEW_EXISTS" } as const;
const REMOVED = { status: "REVIEW_REMOVED" } as const;

const SHORT = "https://maps.app.goo.gl/SP7hAcGTiSuWvvWWA";
const LONG =
  "https://www.google.com/maps/reviews/data=!4m8!14m7!1m6!2m5!1sChdDSUhNMG9nS0VJQ0FnSUNNcS1pbnBRRRAB!2m1!1s0x0:0x5d63c91ab09af4a!3m1!1s2@1:CIHM0ogKEICAgICMq-inpQE%7C%7C?entry=tts";
const REVIEW_ID = "ChdDSUhNMG9nS0VJQ0FnSUNNcS1pbnBRRRAB";
const CID = "420590211543183178";

describe("ApifyChecker", () => {
  const input = { id: 1, googleReviewUrl: SHORT, location: "A & B Lawn and Garden Managed Reputation Lite (5)", reviewerName: "Susan Gaynor", rating: 1 };
  const item = (id: string, total: number, cid = CID) => ({ reviewId: id, reviewOrigin: "Google", name: `Author ${id}`, stars: 1, cid, title: "A & B", reviewsCount: total });
  const others = (n: number, total: number) => Array.from({ length: n }, (_, i) => item(`r${i}`, total));

  /** Fake Apify + Google short link. `runs` counts actor runs; `inputs` records what each was asked for. */
  function apify(items: unknown[], opts: { status?: string; http?: number } = {}) {
    const seen = { runs: 0, inputs: [] as Record<string, unknown>[], auth: "" };
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.startsWith("https://maps.app.goo.gl/")) return new Response(null, { status: 302, headers: { location: LONG } });
      if (opts.http) return new Response("nope", { status: opts.http });
      if (u.includes("/acts/compass~google-maps-reviews-scraper/runs")) {
        seen.runs++;
        seen.inputs.push(JSON.parse(init?.body as string));
        seen.auth = (init?.headers as Record<string, string>).Authorization;
        return new Response(JSON.stringify({ data: { id: "run1", status: "RUNNING", defaultDatasetId: "ds1" } }));
      }
      if (u.includes("/actor-runs/run1")) return new Response(JSON.stringify({ data: { id: "run1", status: opts.status ?? "SUCCEEDED", defaultDatasetId: "ds1" } }));
      if (u.includes("/datasets/ds1/items")) return new Response(JSON.stringify(items));
      throw new Error(`unexpected request ${u}`);
    }) as typeof fetch;
    return { seen, checker: (maxReviews = 0) => new ApifyChecker({ token: "tok", maxReviews, fetchImpl }) };
  }

  it("review ID in the listing -> EXISTS, scraping the place from the link's CID", async () => {
    const a = apify([item("other", 284), item(REVIEW_ID, 284)]);
    expect(await a.checker(1000).checkReview(input)).toEqual(EXISTS);
    expect(a.seen.auth).toBe("Bearer tok");
    expect(a.seen.inputs[0]).toMatchObject({ startUrls: [{ url: `https://www.google.com/maps?cid=${CID}` }], reviewsSort: "newest", maxReviews: 1000 });
  });

  it("one run serves every review of the same place", async () => {
    const a = apify([item(REVIEW_ID, 2), item("other", 2)]);
    const c = a.checker();
    await c.checkReview(input);
    await c.checkReview({ ...input, id: 2 });
    expect(a.seen.runs).toBe(1);
  });

  it("complete listing without the review -> REMOVED, and the confirmation check scrapes again", async () => {
    const a = apify(others(100, 100));
    const c = a.checker();
    expect(await c.checkReview(input)).toEqual(REMOVED);
    expect(await c.checkReview(input)).toEqual(REMOVED);
    expect(a.seen.runs).toBe(2);
  });

  it("listing cut off by maxReviews -> UNKNOWN (never REMOVED)", async () => {
    const r = await apify(others(50, 284)).checker(50).checkReview(input);
    expect(r.status).toBe("UNKNOWN");
  });

  it("listing well short of the place's review count -> UNKNOWN", async () => {
    expect((await apify(others(80, 100)).checker().checkReview(input)).status).toBe("UNKNOWN");
  });

  it("no reviews, a different place, a failed run or an HTTP error -> UNKNOWN", async () => {
    expect((await apify([]).checker().checkReview(input)).status).toBe("UNKNOWN");
    expect((await apify([item(REVIEW_ID, 1, "999")]).checker().checkReview(input)).status).toBe("UNKNOWN");
    expect((await apify(others(3, 3), { status: "FAILED" }).checker().checkReview(input)).status).toBe("UNKNOWN");
    for (const http of [401, 402, 429, 500]) {
      expect((await apify([], { http }).checker().checkReview(input)).status).toBe("UNKNOWN");
    }
    expect((await apify([]).checker().checkReview({ ...input, googleReviewUrl: "https://example.com/x" })).status).toBe("UNKNOWN");
  });

  it("placeReviews returns the place and its newest reviews for display", async () => {
    const a = apify([{ ...item(REVIEW_ID, 284), name: "Susan Gaynor", text: "Bad", address: "5425 River Oaks Blvd", totalScore: 4.4 }]);
    const r = await a.checker().placeReviews(input.location, [SHORT]);
    expect(r).toMatchObject({ name: "A & B", address: "5425 River Oaks Blvd", rating: 4.4, totalReviews: 284, confirmed: true });
    expect(r?.reviews).toMatchObject([{ id: REVIEW_ID, author: "Susan Gaynor", rating: 1, text: "Bad" }]);
    expect(a.seen.inputs[0]).toMatchObject({ maxReviews: 20, personalData: true });
    expect(await a.checker().placeReviews(input.location, [])).toBeNull();
  });
});
