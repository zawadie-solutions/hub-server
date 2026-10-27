import { describe, expect, it } from "vitest";
import { classifyPage, ScrapeChecker } from "../src/google/scrapeChecker";

// What headless Chrome's document.body.innerText looked like for a real, existing review.
const EXISTING = `Search Google Maps
Billion Auto - Toyota in Sioux Falls
Car dealer
PLACE DETAILS
Stephanie Rivera
a year ago
My oil change took 1 hour 20 mins. I am unsure as to why it took that long.
Like
Share
Collapse side panel
Sign in`;

const REMOVED = `Search Google Maps
Billion Auto - Toyota in Sioux Falls
Car dealer
This review is no longer available.
Collapse side panel`;

describe("scrape mode page reading", () => {
  it("calls a review removed only on Google's removal message", () => {
    expect(classifyPage(REMOVED, "Stephanie Rivera")).toEqual({ status: "REVIEW_REMOVED" });
    expect(classifyPage(REMOVED.replace("This review", "this   review"), null)).toEqual({ status: "REVIEW_REMOVED" });
  });

  it("sees an existing review by its reviewer", () => {
    expect(classifyPage(EXISTING, "Stephanie Rivera")).toEqual({ status: "REVIEW_EXISTS" });
  });

  it("sees an existing review card when the reviewer is unknown", () => {
    expect(classifyPage(EXISTING, null)).toEqual({ status: "REVIEW_EXISTS" });
  });

  it("sees a review card whose Like button shows a like count instead", () => {
    const liked = `Tasca Buick GMC Clearwater
Car dealer
Jeremy S.
8 years ago
The wait times for oil changes is unreasonable (90min).
2
Share
Response from the owner 8 years ago`;
    expect(classifyPage(liked, null)).toEqual({ status: "REVIEW_EXISTS" });
    expect(classifyPage(liked, "Jeremy S.")).toEqual({ status: "REVIEW_EXISTS" });
  });

  it("does not take someone else's review as this one", () => {
    expect(classifyPage(EXISTING, "Gabe Chapman").status).toBe("UNKNOWN");
  });

  it("treats a consent or unusual-traffic page as a failed source, not a verdict", () => {
    const consent = classifyPage("Before you continue to Google\nWe use cookies and data to", "Stephanie Rivera");
    expect(consent.status).toBe("UNKNOWN");
    expect(consent.status === "UNKNOWN" && consent.reason.startsWith("google check failed:")).toBe(true);
    expect(classifyPage("Our systems have detected unusual traffic from your computer network.", null).status).toBe("UNKNOWN");
  });

  it("never guesses on an empty or unclear page", () => {
    expect(classifyPage("", "Stephanie Rivera").status).toBe("UNKNOWN");
    expect(classifyPage("Search Google Maps\nSign in", null).status).toBe("UNKNOWN");
  });
});

// ------------------------------------------------------------------ scraper API (remote) mode
const review = { id: 1, googleReviewUrl: "https://maps.app.goo.gl/abc", location: null, reviewerName: "Stephanie Rivera", rating: null };

function fakeApi(respond: (init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return respond(init);
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const remote = (fetchImpl: typeof fetch, timeoutMs?: number) =>
  new ScrapeChecker({ apiUrl: "https://scraper.example/api/render", secret: "s3cret", fetchImpl, timeoutMs });

describe("scrape mode via the scraper API", () => {
  it("sends the link with the secret and classifies the returned page", async () => {
    const api = fakeApi(() => json(200, { finalUrl: "https://www.google.com/maps/reviews/x", text: REMOVED }));
    expect(await remote(api.fetchImpl).checkReview(review)).toEqual({ status: "REVIEW_REMOVED" });
    expect(api.calls[0].url).toBe("https://scraper.example/api/render");
    expect((api.calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer s3cret");
    expect(JSON.parse(api.calls[0].init.body as string)).toEqual({ url: "https://maps.app.goo.gl/abc" });
  });

  it("sees an existing review", async () => {
    const api = fakeApi(() => json(200, { finalUrl: "x", text: EXISTING }));
    expect(await remote(api.fetchImpl).checkReview(review)).toEqual({ status: "REVIEW_EXISTS" });
  });

  it.each([
    [401, { error: "Not authorized" }],
    [502, { error: "Could not render the page: timeout" }],
    [500, "not json"],
  ])("turns HTTP %i into a failed-source UNKNOWN", async (status, body) => {
    const api = fakeApi(() => (typeof body === "string" ? new Response(body, { status }) : json(status, body)));
    const result = await remote(api.fetchImpl).checkReview(review);
    expect(result.status).toBe("UNKNOWN");
    expect(result.status === "UNKNOWN" && result.reason.startsWith("google check failed:")).toBe(true);
    expect(result.status === "UNKNOWN" && result.reason).toContain(`HTTP ${status}`);
  });

  it("turns an unreachable API into a failed-source UNKNOWN", async () => {
    const api = fakeApi(() => {
      throw new TypeError("fetch failed");
    });
    const result = await remote(api.fetchImpl).checkReview(review);
    expect(result.status === "UNKNOWN" && result.reason).toMatch(/^google check failed: could not reach the scraper API/);
  });

  it("gives up on an API that does not answer in time", async () => {
    const api = fakeApi((init) => new Promise<Response>((_, reject) => init.signal?.addEventListener("abort", () => reject(init.signal!.reason))));
    const result = await remote(api.fetchImpl, 50).checkReview(review);
    expect(result.status === "UNKNOWN" && result.reason).toBe("google check failed: the scraper API did not answer in time");
  });

  it("refuses an answer without page text", async () => {
    const api = fakeApi(() => json(200, { finalUrl: "x" }));
    expect((await remote(api.fetchImpl).checkReview(review)).status).toBe("UNKNOWN");
  });
});
