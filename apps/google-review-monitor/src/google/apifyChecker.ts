import { isGoogleReviewUrl } from "../asana/extract";
import { logger } from "../logger";
import type { CheckResult, ReviewChecker, ReviewToCheck } from "../types";
import { parseReviewLink, type PlaceReviews, resolveReviewLink } from "./placesChecker";

/**
 * Checker backed by Apify's "Google Maps Reviews Scraper" actor
 * (compass/google-maps-reviews-scraper), which lists a place's reviews, newest first,
 * for any business — no access to the business's profile needed. Billed per review scraped.
 *
 * How a verdict is reached (every doubt => UNKNOWN):
 *  1. Follow the Asana review link to its long form, which carries the review ID and the
 *     place's CID.
 *  2. Scrape that place's reviews (one actor run per place, reused for all its reviews).
 *  3. REVIEW_EXISTS if a scraped review has that review ID.
 *  4. REVIEW_REMOVED only if the listing was not cut off by `maxReviews` and covers nearly
 *     all of the place's review count. The place is then scraped afresh for the monitor's
 *     confirmation check, so a removal rests on two independent listings.
 *
 * Limits: with `maxReviews` set, a review older than the newest `maxReviews` is UNKNOWN,
 * never REMOVED. Google's review count can exceed what is listable, hence MIN_COVERAGE.
 */

const API = "https://api.apify.com/v2";
const ACTOR = "compass~google-maps-reviews-scraper";
const FIELDS = "reviewId,reviewUrl,reviewOrigin,name,stars,text,publishedAtDate,cid,title,address,totalScore,reviewsCount,url";
/** Share of the place's review count a listing must reach to be trusted as complete. */
const MIN_COVERAGE = 0.95;
const DISPLAY_REVIEWS = 20;

interface ApifyItem {
  reviewId?: string;
  reviewUrl?: string;
  reviewOrigin?: string;
  name?: string;
  stars?: number;
  text?: string;
  publishedAtDate?: string;
  cid?: string;
  title?: string;
  address?: string;
  totalScore?: number;
  reviewsCount?: number;
  url?: string;
}

interface ApifyRun {
  id: string;
  status: string;
  defaultDatasetId: string;
  usageTotalUsd?: number;
  chargedEventCounts?: Record<string, number>;
}

interface Listing {
  total: number | null;
  /** True when the scrape stopped at `maxReviews`, so older reviews were not looked at. */
  capped: boolean;
  reviewIds: Set<string>;
}

export class ApifyChecker implements ReviewChecker {
  private cache = new Map<string, { at: number; listing: Listing }>();

  constructor(
    private opts: {
      token: string;
      /** Newest reviews to scrape per place; 0 = all of them. */
      maxReviews: number;
      fetchImpl?: typeof fetch;
      cacheMs?: number;
      /** Longest to wait for one actor run. */
      runTimeoutMs?: number;
    },
  ) {}

  async checkReview(review: ReviewToCheck): Promise<CheckResult> {
    let result: CheckResult;
    try {
      result = await this.decide(review);
    } catch (e) {
      result = unknown(`google check failed: ${(e as Error).message}`);
    }
    logger.info({ reviewId: review.id, reviewer: review.reviewerName, location: review.location, result }, "apify check result");
    return result;
  }

  private async decide(review: ReviewToCheck): Promise<CheckResult> {
    if (!isGoogleReviewUrl(review.googleReviewUrl)) return unknown("invalid or non-Google review URL");
    const link = await resolveReviewLink(review.googleReviewUrl, this.opts.fetchImpl);
    if (!link) return unknown("review link does not identify a review and place");

    const listing = await this.listing(link.cid);
    if (listing.reviewIds.has(link.reviewId)) return { status: "REVIEW_EXISTS" };

    const got = listing.reviewIds.size;
    if (got === 0) return unknown("Apify returned no reviews for this place");
    if (listing.capped) {
      return unknown(`not among the newest ${got} reviews scraped (${listing.total ?? "?"} on Google); raise the Google reviews per location (Run options) to look further back`);
    }
    if (listing.total === null) return unknown("place review count missing; listing cannot be verified");
    if (got < listing.total * MIN_COVERAGE) return unknown(`incomplete listing: got ${got} of ${listing.total} reviews`);

    // Make the monitor's confirmation check scrape the place again instead of re-reading this listing.
    this.cache.delete(link.cid);
    return { status: "REVIEW_REMOVED" };
  }

  private async listing(cid: string): Promise<Listing> {
    const hit = this.cache.get(cid);
    if (hit && Date.now() - hit.at < (this.opts.cacheMs ?? 30 * 60_000)) return hit.listing;

    const max = this.opts.maxReviews;
    const items = await this.scrape(cid, max, false);
    const listing: Listing = {
      total: items.find((i) => typeof i.reviewsCount === "number")?.reviewsCount ?? null,
      capped: max > 0 && items.length >= max,
      reviewIds: new Set(),
    };
    for (const i of items) {
      const id = i.reviewId ?? (i.reviewUrl ? parseReviewLink(i.reviewUrl)?.reviewId : undefined);
      if (id) listing.reviewIds.add(id);
    }
    this.cache.set(cid, { at: Date.now(), listing });
    return listing;
  }

  /** Runs the actor for one place and returns its Google reviews, newest first. */
  private async scrape(cid: string, maxReviews: number, personalData: boolean): Promise<ApifyItem[]> {
    const input = {
      startUrls: [{ url: `https://www.google.com/maps?cid=${cid}` }],
      reviewsSort: "newest",
      language: "en",
      personalData,
      ...(maxReviews > 0 ? { maxReviews } : {}),
    };
    let run = await this.call<ApifyRun>("POST", `/acts/${ACTOR}/runs?waitForFinish=60`, input);
    const deadline = Date.now() + (this.opts.runTimeoutMs ?? 15 * 60_000);
    while (run.status === "READY" || run.status === "RUNNING") {
      if (Date.now() > deadline) throw new Error(`Apify run ${run.id} still ${run.status} after the time limit`);
      run = await this.call<ApifyRun>("GET", `/actor-runs/${run.id}?waitForFinish=60`);
    }
    if (run.status !== "SUCCEEDED") throw new Error(`Apify run ${run.id} ended ${run.status}`);

    const items = await this.call<ApifyItem[]>("GET", `/datasets/${run.defaultDatasetId}/items?clean=true&format=json&fields=${FIELDS}`);
    if (!Array.isArray(items)) throw new Error("unexpected Apify dataset payload");
    // Debug aid: what the run returned and what Apify says it cost.
    logger.info(
      { cid, runId: run.id, items: items.length, place: items[0]?.title, reviewsCount: items[0]?.reviewsCount, usageUsd: run.usageTotalUsd, charged: run.chargedEventCounts },
      "apify run finished",
    );
    if (items.some((i) => i.cid !== undefined && String(i.cid) !== cid)) throw new Error("Apify returned a different place than the one in the review link");
    return items.filter((i) => !i.reviewOrigin || i.reviewOrigin === "Google");
  }

  private async call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const f = this.opts.fetchImpl ?? fetch;
    const res = await f(API + path, {
      method,
      headers: { Authorization: `Bearer ${this.opts.token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      logger.info({ path: path.split("?")[0], status: res.status, detail }, "apify request failed");
      throw new Error(`Apify returned HTTP ${res.status}`);
    }
    const j = (await res.json()) as unknown;
    // Run endpoints wrap their payload in { data }; dataset items come back as a bare array.
    return (Array.isArray(j) ? j : (j as { data: T }).data) as T;
  }

  /** Display only: the place behind an Asana location and its most recent reviews. Null if no link identifies it. */
  async placeReviews(_location: string, reviewUrls: string[]): Promise<PlaceReviews | null> {
    let cid: string | null = null;
    for (const url of reviewUrls) {
      const link = isGoogleReviewUrl(url) ? await resolveReviewLink(url, this.opts.fetchImpl).catch(() => null) : null;
      if (link) {
        cid = link.cid;
        break;
      }
    }
    if (!cid) return null;
    const items = await this.scrape(cid, DISPLAY_REVIEWS, true);
    const first = items[0];
    return {
      name: first?.title ?? null,
      address: first?.address ?? null,
      googleMapsUri: first?.url ?? `https://www.google.com/maps?cid=${cid}`,
      rating: first?.totalScore ?? null,
      totalReviews: first?.reviewsCount ?? null,
      confirmed: true,
      reviews: items.map((r) => ({
        id: r.reviewId ?? null,
        author: r.name ?? null,
        rating: r.stars ?? null,
        text: r.text ?? null,
        publishedAt: r.publishedAtDate ?? null,
        googleMapsUri: r.reviewUrl ?? null,
      })),
    };
  }
}

function unknown(reason: string): CheckResult {
  return { status: "UNKNOWN", reason };
}
