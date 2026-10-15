import { isGoogleReviewUrl } from "../asana/extract";
import { logger } from "../logger";
import type { CheckResult, ReviewChecker, ReviewToCheck } from "../types";
import { parseReviewLink, type PlaceReviews, resolveReviewLink } from "./placesChecker";

/**
 * Checker backed by DataForSEO's Google Reviews API (Business Data API), which lists a
 * place's reviews, newest first, for any business — no access to the business's profile
 * needed. Billed per 10 reviews requested (`depth`), from a prepaid balance.
 *
 * DataForSEO is a queue: a task is posted, then its result is collected when ready (about a
 * minute on the priority queue, up to 45 minutes on the standard one). `prepare` posts the
 * tasks for every place in a run up front, so the whole run waits roughly one turnaround
 * rather than one per place.
 *
 * How a verdict is reached (every doubt => UNKNOWN):
 *  1. Follow the Asana review link to its long form, which carries the review ID and the
 *     place's CID.
 *  2. Collect that place's review listing (one task per place, reused for all its reviews).
 *  3. REVIEW_EXISTS if a listed review has that review ID.
 *  4. REVIEW_REMOVED only if the listing was not cut off by `maxReviews` and covers nearly
 *     all of the place's review count. The place is then listed afresh (priority queue) for
 *     the monitor's confirmation check, so a removal rests on two independent listings.
 *
 * Limits: DataForSEO returns at most 4,490 reviews per place. A review older than the
 * listing reaches is UNKNOWN, never REMOVED.
 */

const API = "https://api.dataforseo.com/v3/business_data/google/reviews";
const MAX_DEPTH = 4490;
/** Share of the place's review count a listing must reach to be trusted as complete. */
const MIN_COVERAGE = 0.95;
const DISPLAY_REVIEWS = 20;
const TASKS_PER_POST = 100;
/** United States / English. With a CID the place is already exact; these only set the listing's locale. */
const LOCALE = { location_code: 2840, language_code: "en" };

const OK = 20000;
const TASK_CREATED = 20100;
const IN_PROGRESS = new Set([40601, 40602]); // Task Handed, Task In Queue

interface DfsItem {
  review_id?: string;
  review_url?: string;
  profile_name?: string;
  rating?: { value?: number };
  review_text?: string;
  original_review_text?: string;
  timestamp?: string;
}

interface DfsResult {
  title?: string;
  sub_title?: string;
  rating?: { value?: number };
  cid?: string;
  reviews_count?: number;
  items_count?: number;
  check_url?: string;
  items?: DfsItem[] | null;
}

interface DfsTask {
  id: string;
  status_code: number;
  status_message: string;
  cost?: number;
  data?: { cid?: string };
  result?: DfsResult[] | null;
}

interface DfsResponse {
  status_code: number;
  status_message: string;
  cost?: number;
  tasks?: DfsTask[];
}

interface Listing {
  total: number | null;
  /** True when the listing stopped at the requested depth, so older reviews were not looked at. */
  capped: boolean;
  reviewIds: Set<string>;
}

interface Pending {
  id: string;
  priority: boolean;
  depth: number;
}

/** Accepts the plain API login, or the ready-made base64 "login:password" token the dashboard also shows. */
export function basicToken(login: string, password: string): string {
  if (!login.includes("@") && Buffer.from(login, "base64").toString("utf8").endsWith(`:${password}`)) return login;
  return Buffer.from(`${login}:${password}`).toString("base64");
}

/** "2024-05-05 14:09:32 +00:00" -> "2024-05-05T14:09:32+00:00" */
const isoTime = (t: string | undefined) => t?.replace(/^(\S+) (\S+) ([+-]\d\d:\d\d)$/, "$1T$2$3") ?? null;

const sleep = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

export class DataForSeoChecker implements ReviewChecker {
  private cache = new Map<string, { at: number; listing: Listing }>();
  private pending = new Map<string, Pending>();
  private links = new Map<string, { reviewId: string; cid: string } | null>();
  /** Places whose next listing must be fresh and fast: the confirmation of a removal. */
  private urgent = new Set<string>();
  private token: string;

  constructor(
    private opts: {
      login: string;
      password: string;
      /** Newest reviews listed per place; 0 = as many as DataForSEO allows (4,490). */
      maxReviews: number;
      /** Use the priority queue (about a minute, double the price) instead of the standard one. */
      priority: boolean;
      fetchImpl?: typeof fetch;
      cacheMs?: number;
      /** Pause between polls of a task that is not ready yet. */
      pollMs?: number;
      /** Longest to wait for one task. */
      taskTimeoutMs?: number;
    },
  ) {
    this.token = basicToken(opts.login, opts.password);
  }

  private get depth(): number {
    const max = this.opts.maxReviews;
    return max > 0 ? Math.min(max, MAX_DEPTH) : MAX_DEPTH;
  }

  /** Posts the listing task for every place in the run at once. Never throws: a place left out is posted when first checked. */
  async prepare(reviews: ReviewToCheck[]): Promise<void> {
    try {
      const cids = new Set<string>();
      const queue = [...reviews];
      const worker = async () => {
        for (let r = queue.shift(); r; r = queue.shift()) {
          const link = await this.link(r.googleReviewUrl).catch(() => null);
          if (link) cids.add(link.cid);
        }
      };
      await Promise.all(Array.from({ length: 8 }, worker));
      const need = [...cids].filter((cid) => !this.fresh(cid) && !this.pending.has(cid));
      for (let i = 0; i < need.length; i += TASKS_PER_POST) {
        await this.post(need.slice(i, i + TASKS_PER_POST), this.depth, this.opts.priority);
      }
      logger.info({ places: cids.size, posted: need.length, priority: this.opts.priority, depth: this.depth }, "dataforseo tasks posted for the run");
    } catch (e) {
      logger.warn({ err: (e as Error).message }, "dataforseo prepare failed; places will be listed one at a time");
    }
  }

  async checkReview(review: ReviewToCheck): Promise<CheckResult> {
    let result: CheckResult;
    try {
      result = await this.decide(review);
    } catch (e) {
      result = unknown(`google check failed: ${(e as Error).message}`);
    }
    logger.info({ reviewId: review.id, reviewer: review.reviewerName, location: review.location, result }, "dataforseo check result");
    return result;
  }

  private async decide(review: ReviewToCheck): Promise<CheckResult> {
    if (!isGoogleReviewUrl(review.googleReviewUrl)) return unknown("invalid or non-Google review URL");
    const link = await this.link(review.googleReviewUrl);
    if (!link) return unknown("review link does not identify a review and place");

    const listing = await this.listing(link.cid);
    if (listing.reviewIds.has(link.reviewId)) return { status: "REVIEW_EXISTS" };

    const got = listing.reviewIds.size;
    if (got === 0) return unknown("DataForSEO returned no reviews for this place");
    if (listing.capped) {
      return unknown(`not among the newest ${got} reviews listed (${listing.total ?? "?"} on Google); raise the Google reviews per location (Run options) to look further back`);
    }
    if (listing.total === null) return unknown("place review count missing; listing cannot be verified");
    if (got < listing.total * MIN_COVERAGE) return unknown(`incomplete listing: got ${got} of ${listing.total} reviews`);

    // Make the monitor's confirmation check list the place again, quickly, instead of re-reading this listing.
    this.cache.delete(link.cid);
    this.urgent.add(link.cid);
    return { status: "REVIEW_REMOVED" };
  }

  private async link(url: string) {
    if (this.links.has(url)) return this.links.get(url) ?? null;
    const link = await resolveReviewLink(url, this.opts.fetchImpl);
    this.links.set(url, link);
    return link;
  }

  private fresh(cid: string): Listing | null {
    const hit = this.cache.get(cid);
    return hit && Date.now() - hit.at < (this.opts.cacheMs ?? 60 * 60_000) ? hit.listing : null;
  }

  private async listing(cid: string): Promise<Listing> {
    const hit = this.fresh(cid);
    if (hit) return hit;

    if (!this.pending.has(cid)) await this.post([cid], this.depth, this.opts.priority || this.urgent.has(cid));
    this.urgent.delete(cid);
    const task = this.pending.get(cid);
    if (!task) throw new Error("DataForSEO did not accept the task for this place");
    let result: DfsResult | null;
    try {
      result = await this.collect(task);
    } finally {
      this.pending.delete(cid);
    }
    if (result?.cid !== undefined && String(result.cid) !== cid) throw new Error("DataForSEO returned a different place than the one in the review link");

    const items = result?.items ?? [];
    const total = typeof result?.reviews_count === "number" ? result.reviews_count : null;
    const listing: Listing = { total, capped: items.length >= task.depth && (total === null || total > items.length), reviewIds: new Set() };
    for (const i of items) {
      const id = i.review_id ?? (i.review_url ? parseReviewLink(i.review_url)?.reviewId : undefined);
      if (id) listing.reviewIds.add(id);
    }
    this.cache.set(cid, { at: Date.now(), listing });
    return listing;
  }

  /** Creates one listing task per CID (at most 100 per call) and remembers their ids. */
  private async post(cids: string[], depth: number, priority: boolean): Promise<void> {
    const body = cids.map((cid) => ({ cid, ...LOCALE, depth, sort_by: "newest", priority: priority ? 2 : 1 }));
    const res = await this.call("POST", "/task_post", body);
    for (const t of res.tasks ?? []) {
      const cid = t.data?.cid;
      if (t.status_code === TASK_CREATED && cid) this.pending.set(String(cid), { id: t.id, priority, depth });
      else logger.warn({ cid, status: t.status_code, message: t.status_message }, "dataforseo task not created");
    }
    // Debug aid: what was requested and what DataForSEO says it charged.
    logger.info({ places: cids.length, depth, priority, costUsd: res.cost }, "dataforseo tasks posted");
    const failed = (res.tasks ?? []).find((t) => t.status_code !== TASK_CREATED);
    if (cids.length === 1 && failed) throw new Error(`DataForSEO: ${failed.status_message} (${failed.status_code})`);
  }

  /** Waits for a task to finish and returns its result (null when the place has no reviews). */
  private async collect(task: Pending): Promise<DfsResult | null> {
    const pollMs = this.opts.pollMs ?? (task.priority ? 5_000 : 20_000);
    const deadline = Date.now() + (this.opts.taskTimeoutMs ?? (task.priority ? 10 * 60_000 : 60 * 60_000));
    for (;;) {
      const res = await this.call("GET", `/task_get/${task.id}`);
      const t = res.tasks?.[0];
      if (!t) throw new Error("unexpected DataForSEO task payload");
      if (t.status_code === OK) {
        const result = t.result?.[0] ?? null;
        logger.info({ taskId: task.id, place: result?.title, items: result?.items_count, reviewsCount: result?.reviews_count }, "dataforseo task finished");
        return result;
      }
      if (!IN_PROGRESS.has(t.status_code)) throw new Error(`DataForSEO: ${t.status_message} (${t.status_code})`);
      if (Date.now() > deadline) throw new Error(`DataForSEO task ${task.id} not ready within the time limit`);
      await sleep(pollMs);
    }
  }

  private async call(method: "GET" | "POST", path: string, body?: unknown): Promise<DfsResponse> {
    const f = this.opts.fetchImpl ?? fetch;
    const res = await f(API + path, {
      method,
      headers: { Authorization: `Basic ${this.token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = (await res.json().catch(() => null)) as DfsResponse | null;
    if (!res.ok || !j || j.status_code !== OK) {
      logger.info({ path: path.split("/").slice(0, 2).join("/"), http: res.status, status: j?.status_code, message: j?.status_message }, "dataforseo request failed");
      throw new Error(`DataForSEO: ${j?.status_message ?? "no response body"} (HTTP ${res.status}${j ? `, ${j.status_code}` : ""})`);
    }
    return j;
  }

  /** Display only: the place behind an Asana location and its most recent reviews. Null if no link identifies it. */
  async placeReviews(_location: string, reviewUrls: string[]): Promise<PlaceReviews | null> {
    let cid: string | null = null;
    for (const url of reviewUrls) {
      const link = isGoogleReviewUrl(url) ? await this.link(url).catch(() => null) : null;
      if (link) {
        cid = link.cid;
        break;
      }
    }
    if (!cid) return null;
    // Its own small, fast task, kept out of `pending` so it never stands in for a full listing.
    const res = await this.call("POST", "/task_post", [{ cid, ...LOCALE, depth: DISPLAY_REVIEWS, sort_by: "newest", priority: 2 }]);
    const t = res.tasks?.[0];
    if (!t || t.status_code !== TASK_CREATED) throw new Error(`DataForSEO: ${t?.status_message ?? "task not created"}`);
    const result = await this.collect({ id: t.id, priority: true, depth: DISPLAY_REVIEWS });
    return {
      name: result?.title ?? null,
      address: result?.sub_title ?? null,
      googleMapsUri: result?.check_url ?? `https://www.google.com/maps?cid=${cid}`,
      rating: result?.rating?.value ?? null,
      totalReviews: result?.reviews_count ?? null,
      confirmed: true,
      reviews: (result?.items ?? []).map((r) => ({
        id: r.review_id ?? null,
        author: r.profile_name ?? null,
        rating: r.rating?.value ?? null,
        text: r.original_review_text ?? r.review_text ?? null,
        publishedAt: isoTime(r.timestamp),
        googleMapsUri: r.review_url ?? null,
      })),
    };
  }
}

function unknown(reason: string): CheckResult {
  return { status: "UNKNOWN", reason };
}
