import { readFileSync } from "node:fs";
import { isGoogleReviewUrl } from "../asana/extract";
import type { CheckResult, ReviewChecker, ReviewToCheck } from "../types";

/**
 * Checker backed by the official Google Business Profile API
 * (mybusiness.googleapis.com/v4 accounts.locations.reviews.list).
 *
 * How a verdict is reached (every doubt => UNKNOWN):
 *  1. Fetch ALL reviews of the location. If the number fetched differs from the API's
 *     totalReviewCount, the listing is treated as incomplete => UNKNOWN.
 *  2. A review is "present" if any listed review has the same (normalised) reviewer name.
 *  3. REVIEW_REMOVED only if the complete listing has no such reviewer.
 *
 * Limits: requires the authorised Google account to manage the location, and matches by
 * reviewer display name (Asana does not hold the Google reviewId). A reviewer who renamed
 * their profile would look removed; the monitor re-checks before accepting a removal.
 */

export interface TokenProvider {
  getAccessToken(): Promise<string>;
}

export class OAuthRefreshTokenProvider implements TokenProvider {
  private token?: { value: string; expiresAt: number };
  constructor(
    private o: { clientId: string; clientSecret: string; refreshToken: string },
    private fetchImpl: typeof fetch = fetch,
  ) {}

  async getAccessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    const res = await this.fetchImpl("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.o.clientId,
        client_secret: this.o.clientSecret,
        refresh_token: this.o.refreshToken,
        grant_type: "refresh_token",
      }),
    });
    if (!res.ok) throw new Error(`google auth failed (${res.status})`);
    const j = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!j.access_token) throw new Error("google auth failed: no access_token");
    this.token = { value: j.access_token, expiresAt: Date.now() + (j.expires_in ?? 3600) * 1000 };
    return j.access_token;
  }
}

interface GbpReview {
  reviewer?: { displayName?: string; isAnonymous?: boolean };
}

export const norm = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const ANONYMOUS = new Set(["a google user", "google user", "anonymous"]);

export function loadLocationMap(file: string): Record<string, string> {
  const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, string>;
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [norm(k), v]));
}

export class BusinessProfileChecker implements ReviewChecker {
  private cache = new Map<string, { at: number; names: Set<string> }>();

  constructor(
    private opts: {
      auth: TokenProvider;
      /** normalised Asana location name -> "accounts/{a}/locations/{l}" */
      locationMap: Record<string, string>;
      fetchImpl?: typeof fetch;
      cacheMs?: number;
    },
  ) {}

  async checkReview(review: ReviewToCheck): Promise<CheckResult> {
    try {
      if (!isGoogleReviewUrl(review.googleReviewUrl)) return unknown("invalid or non-Google review URL");
      if (!review.location) return unknown("review has no location");
      const locationName = this.opts.locationMap[norm(review.location)];
      if (!locationName) return unknown(`no Google location configured for "${review.location}"`);
      if (!review.reviewerName) return unknown("reviewer name unknown; cannot identify the review");
      const wanted = norm(review.reviewerName);
      if (!wanted || ANONYMOUS.has(wanted)) return unknown("reviewer name is anonymous/ambiguous");

      const names = await this.reviewerNames(locationName);
      return names.has(wanted) ? { status: "REVIEW_EXISTS" } : { status: "REVIEW_REMOVED" };
    } catch (e) {
      return unknown(`google check failed: ${(e as Error).message}`);
    }
  }

  private async reviewerNames(locationName: string): Promise<Set<string>> {
    const hit = this.cache.get(locationName);
    if (hit && Date.now() - hit.at < (this.opts.cacheMs ?? 5 * 60_000)) return hit.names;

    const f = this.opts.fetchImpl ?? fetch;
    const names = new Set<string>();
    let fetched = 0;
    let total: number | undefined;
    let pageToken: string | undefined;
    do {
      const url = new URL(`https://mybusiness.googleapis.com/v4/${locationName}/reviews`);
      url.searchParams.set("pageSize", "50");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const res = await f(url, { headers: { Authorization: `Bearer ${await this.opts.auth.getAccessToken()}` } });
      if (!res.ok) throw new Error(`reviews.list returned HTTP ${res.status}`);
      const j = (await res.json()) as { reviews?: GbpReview[]; totalReviewCount?: number; nextPageToken?: string };
      if (j.reviews !== undefined && !Array.isArray(j.reviews)) throw new Error("unexpected reviews payload");
      for (const r of j.reviews ?? []) {
        fetched++;
        if (r.reviewer?.displayName) names.add(norm(r.reviewer.displayName));
      }
      total = j.totalReviewCount ?? total;
      pageToken = j.nextPageToken;
    } while (pageToken);

    if (typeof total !== "number") throw new Error("response missing totalReviewCount; listing cannot be verified");
    if (fetched !== total) throw new Error(`incomplete listing: got ${fetched} of ${total} reviews`);

    this.cache.set(locationName, { at: Date.now(), names });
    return names;
  }
}

function unknown(reason: string): CheckResult {
  return { status: "UNKNOWN", reason };
}
