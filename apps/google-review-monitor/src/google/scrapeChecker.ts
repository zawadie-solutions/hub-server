import { logger } from "../logger";
import type { CheckResult, ReviewChecker, ReviewToCheck } from "../types";

/**
 * Scrape mode (for testing): has the review scraper API (a separate project on Vercel) open the
 * review's own Google link in headless Chrome, then reads what Google showed. Google Maps builds
 * the page with JavaScript, so a plain HTTP fetch only gets an empty app shell — a real browser
 * is needed, and the hub's hosting can't run one.
 *
 * The API's contract: POST {SCRAPE_API_URL} with `Authorization: Bearer {SCRAPE_API_SECRET}` and
 * body {"url": "<review link>"} -> 200 {"finalUrl", "text"} (the page's visible text), or a non-2xx
 * {"error"} (401 bad secret, 400 not a review link, 502 could not render). The API only renders;
 * the verdict is decided here.
 *
 * How a verdict is reached (every doubt => UNKNOWN):
 *  - REVIEW_REMOVED only when the page says "This review is no longer available".
 *  - REVIEW_EXISTS when the review itself is on the page (its reviewer's name, or a review card).
 *  - Anything else — a consent/"unusual traffic" page, a timeout, a page showing neither — is
 *    UNKNOWN.
 *
 * Slow (several seconds per review) and dependent on Google's page wording, so it suits checking
 * a handful of reviews, not a whole month.
 */

/** Google's wording when the review behind a link has been taken down. */
export const REMOVED_TEXT = "this review is no longer available";

/** How every checker words an UNKNOWN that means "the source itself failed" (see FallbackChecker). */
const SOURCE_FAILED = "google check failed:";

/** Pages that are Google asking something of the visitor, not the review. */
const BLOCKED_PAGES = [/before you continue to google/i, /unusual traffic from your computer/i, /our systems have detected unusual traffic/i];

/** A review card's relative date, e.g. "a year ago", "2 weeks ago". */
const REVIEW_AGE = /\b(?:a|an|\d+)\s+(?:minute|hour|day|week|month|year)s?\s+ago\b/i;

/** What the rendered page says about the review. Pure, so it can be tested without the API. */
export function classifyPage(pageText: string, reviewerName: string | null): CheckResult {
  const text = pageText.replace(/\s+/g, " ");
  if (text.toLowerCase().includes(REMOVED_TEXT)) return { status: "REVIEW_REMOVED" };
  if (BLOCKED_PAGES.some((re) => re.test(text))) return { status: "UNKNOWN", reason: `${SOURCE_FAILED} Google showed a consent or "unusual traffic" page instead of the review` };
  const firstName = reviewerName?.trim().split(/\s+/)[0];
  if (firstName && firstName.length >= 2 && text.toLowerCase().includes(firstName.toLowerCase()) && REVIEW_AGE.test(text)) return { status: "REVIEW_EXISTS" };
  // Reviewer unknown: a review card is its date plus the Share button ("Like" turns into the
  // like count once a review has likes, so it can't be relied on).
  if (!firstName && REVIEW_AGE.test(text) && /\bShare\b/.test(text)) return { status: "REVIEW_EXISTS" };
  return { status: "UNKNOWN", reason: "scrape: the page showed neither the review nor Google's removal message" };
}

export interface ScrapeOptions {
  /** SCRAPE_API_URL, e.g. https://review-scraper-api.vercel.app/api/render */
  apiUrl: string;
  /** SCRAPE_API_SECRET — must equal the API's SCRAPER_API_SECRET. */
  secret: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

type PageRead = { text: string } | { failed: string };

export class ScrapeChecker implements ReviewChecker {
  constructor(private opts: ScrapeOptions) {}

  async checkReview(review: ReviewToCheck): Promise<CheckResult> {
    const read = await this.render(review.googleReviewUrl);
    if ("failed" in read) return { status: "UNKNOWN", reason: `${SOURCE_FAILED} ${read.failed}` };
    const result = classifyPage(read.text, review.reviewerName);
    logger.info({ reviewId: review.id, status: result.status }, "scrape check");
    return result;
  }

  /** Asks the scraper API to render the page and return its text. */
  private async render(url: string): Promise<PageRead> {
    const fetchImpl = this.opts.fetchImpl ?? fetch;
    let res: Response;
    try {
      res = await fetchImpl(this.opts.apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.opts.secret}` },
        body: JSON.stringify({ url: withEnglish(url) }),
        // A cold start launches Chrome first, so allow for that on top of the page itself.
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 75_000),
      });
    } catch (e) {
      const err = e as Error;
      return { failed: err.name === "TimeoutError" ? "the scraper API did not answer in time" : `could not reach the scraper API (${err.message})` };
    }
    const body = (await res.json().catch(() => null)) as { text?: unknown; error?: unknown } | null;
    if (!res.ok) return { failed: `the scraper API answered HTTP ${res.status}${typeof body?.error === "string" ? ` (${body.error})` : ""}` };
    if (typeof body?.text !== "string") return { failed: "the scraper API's answer had no page text" };
    return { text: body.text };
  }
}

/**
 * Asks Google for the English page, so the removal message is in the wording we look for. Only
 * on google.com links: a maps.app.goo.gl short link is left exactly as it is (the API's browser
 * is set to English, which covers where it redirects to).
 */
function withEnglish(url: string): string {
  try {
    const u = new URL(url);
    if (!/(^|\.)google\.[a-z.]+$/.test(u.hostname)) return url;
    if (!u.searchParams.has("hl")) u.searchParams.set("hl", "en");
    return u.toString();
  } catch {
    return url;
  }
}
