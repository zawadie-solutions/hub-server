import { describe, expect, it } from "vitest";
import { businessNameFromLocation, parseReviewLink, PlacesChecker } from "../src/google/placesChecker";

const EXISTS = { status: "REVIEW_EXISTS" } as const;
const REMOVED = { status: "REVIEW_REMOVED" } as const;

const SHORT = "https://maps.app.goo.gl/SP7hAcGTiSuWvvWWA";
const LONG =
  "https://www.google.com/maps/reviews/data=!4m8!14m7!1m6!2m5!1sChdDSUhNMG9nS0VJQ0FnSUNNcS1pbnBRRRAB!2m1!1s0x0:0x5d63c91ab09af4a!3m1!1s2@1:CIHM0ogKEICAgICMq-inpQE%7C%7C?entry=tts";
const REVIEW_ID = "ChdDSUhNMG9nS0VJQ0FnSUNNcS1pbnBRRRAB";
const CID = "420590211543183178";

describe("PlacesChecker", () => {
  const input = { id: 1, googleReviewUrl: SHORT, location: "A & B Lawn and Garden Managed Reputation Lite (5)", reviewerName: "Susan Gaynor", rating: 1 };
  const place = (reviews: { id: string; author: string }[], total: number, cid = CID) => ({
    id: "ChIJ1",
    googleMapsUri: `https://maps.google.com/?cid=${cid}`,
    userRatingCount: total,
    reviews: reviews.map((r) => ({ name: `places/ChIJ1/reviews/${r.id}`, authorAttribution: { displayName: r.author } })),
  });
  /** Short link redirects to the long one; the search returns the given places. */
  const google = (places: unknown[], searchStatus = 200) =>
    (async (url: string) =>
      String(url).startsWith("https://maps.app.goo.gl/")
        ? new Response(null, { status: 302, headers: { location: LONG } })
        : new Response(JSON.stringify({ places }), { status: searchStatus })) as typeof fetch;
  const checker = (fetchImpl: typeof fetch) => new PlacesChecker({ apiKey: "k", fetchImpl, cacheMs: 0 });

  it("parses the review ID and CID out of a long review link", () => {
    expect(parseReviewLink(LONG)).toEqual({ reviewId: REVIEW_ID, cid: CID });
    expect(parseReviewLink(SHORT)).toBeNull();
  });
  it("strips the Asana package suffix from the location", () => {
    expect(businessNameFromLocation("RV World Yuma Managed Disputes Lite (5)")).toBe("RV World Yuma");
    expect(businessNameFromLocation("Plain Name")).toBe("Plain Name");
  });
  it("review ID returned -> EXISTS", async () => {
    expect(await checker(google([place([{ id: REVIEW_ID, author: "Renamed" }], 284)])).checkReview(input)).toEqual(EXISTS);
  });
  it("reviewer name returned -> EXISTS", async () => {
    expect(await checker(google([place([{ id: "other", author: "susan  GAYNOR" }], 284)])).checkReview(input)).toEqual(EXISTS);
  });
  it("complete listing without the review -> REMOVED", async () => {
    expect(await checker(google([place([{ id: "other", author: "Mary" }], 1)])).checkReview(input)).toEqual(REMOVED);
  });
  it("partial listing without the review -> UNKNOWN (never REMOVED)", async () => {
    const reviews = [1, 2, 3, 4, 5].map((n) => ({ id: `r${n}`, author: `A${n}` }));
    expect((await checker(google([place(reviews, 284)])).checkReview(input)).status).toBe("UNKNOWN");
  });
  it("no reviews returned for a place that has some -> UNKNOWN", async () => {
    expect((await checker(google([place([], 284)])).checkReview(input)).status).toBe("UNKNOWN");
  });
  it("search does not return the place in the link -> UNKNOWN", async () => {
    expect((await checker(google([place([{ id: REVIEW_ID, author: "Susan Gaynor" }], 1, "999")])).checkReview(input)).status).toBe("UNKNOWN");
    expect((await checker(google([])).checkReview(input)).status).toBe("UNKNOWN");
  });
  it("placeReviews returns the place matched by the link's CID with its reviews", async () => {
    const other = { ...place([], 9, "999"), displayName: { text: "Other" } };
    const mine = { ...place([{ id: REVIEW_ID, author: "Susan Gaynor" }], 284), displayName: { text: "A & B" } };
    const r = await checker(google([other, mine])).placeReviews(input.location, [SHORT]);
    expect(r).toMatchObject({ name: "A & B", totalReviews: 284, confirmed: true });
    expect(r?.reviews).toMatchObject([{ id: REVIEW_ID, author: "Susan Gaynor" }]);
    // no usable link: falls back to the top result, flagged as unconfirmed
    expect(await checker(google([other, mine])).placeReviews(input.location, [])).toMatchObject({ name: "Other", confirmed: false });
    expect(await checker(google([other])).placeReviews(input.location, [SHORT])).toBeNull();
  });

  it("HTTP error / network failure / unresolvable link -> UNKNOWN", async () => {
    for (const status of [400, 403, 429, 500]) {
      expect((await checker(google([], status)).checkReview(input)).status).toBe("UNKNOWN");
    }
    expect((await checker((async () => { throw new Error("ETIMEDOUT"); }) as never).checkReview(input)).status).toBe("UNKNOWN");
    expect((await checker((async () => new Response("")) as never).checkReview(input)).status).toBe("UNKNOWN");
    expect((await checker(google([])).checkReview({ ...input, googleReviewUrl: "https://example.com/x" })).status).toBe("UNKNOWN");
  });
});
