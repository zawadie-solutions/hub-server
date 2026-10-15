import { isGoogleReviewUrl } from "../asana/extract";
import { logger } from "../logger";
import type { CheckResult, ReviewChecker, ReviewToCheck } from "../types";
import { norm } from "./businessProfileChecker";

/**
 * Checker backed by the Places API (New), authenticated with a plain API key
 * (places.googleapis.com/v1/places:searchText). Needs no access to the business's profile.
 *
 * How a verdict is reached (every doubt => UNKNOWN):
 *  1. Follow the Asana review link to its long form, which carries the review ID and the
 *     place's CID.
 *  2. Text-search the Asana location name and keep the result whose CID matches the link.
 *  3. REVIEW_EXISTS if one of the place's returned reviews has that review ID (or the same
 *     normalised reviewer name).
 *  4. REVIEW_REMOVED only if Places returned every review the place has and it is not there.
 *
 * Limits: Places returns at most 5 reviews per place, so for any place with more reviews
 * than that an absent review is UNKNOWN, never REMOVED.
 */

interface PlacesReview {
  name?: string;
  authorAttribution?: { displayName?: string };
  rating?: number;
  text?: { text?: string };
  originalText?: { text?: string };
  publishTime?: string;
  googleMapsUri?: string;
}

interface PlacesPlace {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  googleMapsUri?: string;
  rating?: number;
  userRatingCount?: number;
  reviews?: PlacesReview[];
}

/** What the dashboard shows for a location's "reviews on Google" panel. */
export interface PlaceReviews {
  name: string | null;
  address: string | null;
  googleMapsUri: string | null;
  rating: number | null;
  totalReviews: number | null;
  /** True when the place was matched to the CID in one of the location's review links. */
  confirmed: boolean;
  reviews: {
    id: string | null;
    author: string | null;
    rating: number | null;
    text: string | null;
    publishedAt: string | null;
    googleMapsUri: string | null;
  }[];
}

interface PlaceListing {
  total: number;
  reviewIds: Set<string>;
  names: Set<string>;
}

/** "https://www.google.com/maps/reviews/data=...!1s<reviewId>!2m1!1s0x0:0x<cid>..." -> its review ID and decimal CID. */
export function parseReviewLink(url: string): { reviewId: string; cid: string } | null {
  const m = url.match(/!1s([^!?&]+)!2m1!1s0x[0-9a-f]+:0x([0-9a-f]+)/i);
  if (!m) return null;
  return { reviewId: decodeURIComponent(m[1]), cid: BigInt(`0x${m[2]}`).toString() };
}

/** Short links (maps.app.goo.gl) redirect to the long form that holds the IDs; null if none is reached. */
export async function resolveReviewLink(url: string, fetchImpl: typeof fetch = fetch) {
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    const parsed = parseReviewLink(current);
    if (parsed) return parsed;
    const res = await fetchImpl(current, { redirect: "manual" });
    const next = res.headers.get("location");
    if (!next) return null;
    current = new URL(next, current).href;
  }
  return parseReviewLink(current);
}

/** "A & B Lawn and Garden Managed Reputation Lite (5)" -> "A & B Lawn and Garden". */
export function businessNameFromLocation(location: string): string {
  return location.replace(/\s+Managed\s+(?:Reputation|Disputes)\b.*$/i, "").trim();
}

export class PlacesChecker implements ReviewChecker {
  private cache = new Map<string, { at: number; listing: PlaceListing }>();

  constructor(private opts: { apiKey: string; fetchImpl?: typeof fetch; cacheMs?: number }) {}

  async checkReview(review: ReviewToCheck): Promise<CheckResult> {
    let result: CheckResult;
    try {
      result = await this.decide(review);
    } catch (e) {
      result = unknown(`google check failed: ${(e as Error).message}`);
    }
    logger.info({ reviewId: review.id, reviewer: review.reviewerName, location: review.location, result }, "places check result");
    return result;
  }

  private async decide(review: ReviewToCheck): Promise<CheckResult> {
    if (!isGoogleReviewUrl(review.googleReviewUrl)) return unknown("invalid or non-Google review URL");
    if (!review.location) return unknown("review has no location");
    const link = await resolveReviewLink(review.googleReviewUrl, this.opts.fetchImpl);
    logger.info({ url: review.googleReviewUrl, link }, "places: review link resolved");
    if (!link) return unknown("review link does not identify a review and place");

    const listing = await this.listing(businessNameFromLocation(review.location), link.cid);
    if (!listing) return unknown(`Places search for "${review.location}" did not return the place in the review link`);

    const wanted = review.reviewerName ? norm(review.reviewerName) : "";
    if (listing.reviewIds.has(link.reviewId) || (wanted && listing.names.has(wanted))) return { status: "REVIEW_EXISTS" };

    const returned = listing.reviewIds.size;
    if (returned === 0 && listing.total > 0) return unknown(`Places API returned no reviews for this place (${listing.total} on Google)`);
    if (returned < listing.total) return unknown(`not among the ${returned} of ${listing.total} reviews the Places API returns`);
    return { status: "REVIEW_REMOVED" };
  }

  private async listing(businessName: string, cid: string): Promise<PlaceListing | null> {
    const hit = this.cache.get(cid);
    if (hit && Date.now() - hit.at < (this.opts.cacheMs ?? 5 * 60_000)) return hit.listing;

    const places = await this.search(businessName, "places.id,places.googleMapsUri,places.userRatingCount,places.reviews.name,places.reviews.authorAttribution");
    const place = places.find((p) => cidOf(p) === cid);
    if (!place) return null;
    if (typeof place.userRatingCount !== "number") throw new Error("response missing userRatingCount; listing cannot be verified");

    const listing: PlaceListing = { total: place.userRatingCount, reviewIds: new Set(), names: new Set() };
    for (const r of place.reviews ?? []) {
      if (!r.name) throw new Error("unexpected review payload");
      listing.reviewIds.add(r.name.split("/").pop() as string);
      if (r.authorAttribution?.displayName) listing.names.add(norm(r.authorAttribution.displayName));
    }
    this.cache.set(cid, { at: Date.now(), listing });
    return listing;
  }

  private async search(businessName: string, fieldMask: string): Promise<PlacesPlace[]> {
    const f = this.opts.fetchImpl ?? fetch;
    const res = await f("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": this.opts.apiKey, "X-Goog-FieldMask": fieldMask },
      body: JSON.stringify({ textQuery: businessName }),
    });
    if (!res.ok) {
      logger.info({ textQuery: businessName, status: res.status, body: await res.text().catch(() => "") }, "places:searchText failed");
      throw new Error(`places:searchText returned HTTP ${res.status}`);
    }
    const j = (await res.json()) as { places?: PlacesPlace[] };
    // Debug aid: the raw Places answer, pretty-printed so it can be read in the terminal.
    logger.info({ textQuery: businessName, fieldMask, status: res.status }, "places:searchText response");
    if (logger.isLevelEnabled("info")) console.log(JSON.stringify(j, null, 2));
    if (j.places !== undefined && !Array.isArray(j.places)) throw new Error("unexpected places payload");
    return j.places ?? [];
  }

  /**
   * Display only: the place behind an Asana location and whatever reviews Places returns for
   * it (at most 5). The place is the one named by the first review link that resolves; with
   * no usable link it is the top search result (`confirmed: false`). Null if none is found.
   */
  async placeReviews(location: string, reviewUrls: string[]): Promise<PlaceReviews | null> {
    let cid: string | null = null;
    for (const url of reviewUrls) {
      const link = isGoogleReviewUrl(url) ? await resolveReviewLink(url, this.opts.fetchImpl).catch(() => null) : null;
      if (link) {
        cid = link.cid;
        break;
      }
    }
    const places = await this.search(
      businessNameFromLocation(location),
      "places.id,places.displayName,places.formattedAddress,places.googleMapsUri,places.rating,places.userRatingCount,places.reviews",
    );
    const place = cid ? places.find((p) => cidOf(p) === cid) : places[0];
    if (!place) return null;
    return {
      name: place.displayName?.text ?? null,
      address: place.formattedAddress ?? null,
      googleMapsUri: place.googleMapsUri ?? null,
      rating: place.rating ?? null,
      totalReviews: place.userRatingCount ?? null,
      confirmed: cid !== null,
      reviews: (place.reviews ?? []).map((r) => ({
        id: r.name?.split("/").pop() ?? null,
        author: r.authorAttribution?.displayName ?? null,
        rating: r.rating ?? null,
        text: r.originalText?.text ?? r.text?.text ?? null,
        publishedAt: r.publishTime ?? null,
        googleMapsUri: r.googleMapsUri ?? null,
      })),
    };
  }
}

function cidOf(p: PlacesPlace): string | null {
  return p.googleMapsUri ? new URL(p.googleMapsUri).searchParams.get("cid") : null;
}

function unknown(reason: string): CheckResult {
  return { status: "UNKNOWN", reason };
}
