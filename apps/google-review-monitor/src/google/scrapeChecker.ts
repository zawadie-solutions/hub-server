import { existsSync } from "node:fs";
import type { Browser } from "puppeteer-core";
import { logger } from "../logger";
import type { CheckResult, ReviewChecker, ReviewToCheck } from "../types";

/**
 * Scrape mode (for testing): opens the review's own Google link in a headless Chrome/Edge and
 * reads what Google shows. Google Maps builds the page with JavaScript, so a plain HTTP fetch
 * only gets an empty app shell — a real browser is needed to see either the review or Google's
 * removal message.
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

/** What the rendered page says about the review. Pure, so it can be tested without a browser. */
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

/** Installed Chrome or Edge, if any (SCRAPE_BROWSER_PATH wins). */
export function findBrowser(explicit?: string): string | null {
  const candidates = [
    explicit,
    process.env.ProgramFiles && `${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`,
    process.env["ProgramFiles(x86)"] && `${process.env["ProgramFiles(x86)"]}\\Google\\Chrome\\Application\\chrome.exe`,
    process.env.LOCALAPPDATA && `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
    process.env["ProgramFiles(x86)"] && `${process.env["ProgramFiles(x86)"]}\\Microsoft\\Edge\\Application\\msedge.exe`,
    process.env.ProgramFiles && `${process.env.ProgramFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ];
  return candidates.find((p): p is string => Boolean(p) && existsSync(p as string)) ?? null;
}

// One browser shared by every check, started on first use and closed after a quiet minute.
const IDLE_CLOSE_MS = 60_000;
let shared: { path: string; browser: Promise<Browser> } | null = null;
let idleTimer: NodeJS.Timeout | null = null;
let inUse = 0;

async function acquire(path: string): Promise<Browser> {
  if (idleTimer) clearTimeout(idleTimer);
  if (!shared || shared.path !== path) {
    const { default: puppeteer } = await import("puppeteer-core");
    shared = { path, browser: puppeteer.launch({ executablePath: path, headless: true, args: ["--lang=en-US", "--no-first-run"] }) };
  }
  inUse++;
  try {
    return await shared.browser;
  } catch (e) {
    shared = null;
    inUse--;
    throw e;
  }
}

function release(): void {
  inUse--;
  if (inUse > 0) return;
  idleTimer = setTimeout(() => {
    const s = shared;
    shared = null;
    s?.browser.then((b) => b.close()).catch(() => undefined);
  }, IDLE_CLOSE_MS);
  idleTimer.unref();
}

export class ScrapeChecker implements ReviewChecker {
  constructor(private opts: { browserPath: string; timeoutMs?: number }) {}

  async checkReview(review: ReviewToCheck): Promise<CheckResult> {
    const timeoutMs = this.opts.timeoutMs ?? 45_000;
    let browser: Browser;
    try {
      browser = await acquire(this.opts.browserPath);
    } catch (e) {
      return { status: "UNKNOWN", reason: `${SOURCE_FAILED} could not start the browser (${(e as Error).message})` };
    }
    const page = await browser.newPage().catch(() => null);
    if (!page) {
      release();
      return { status: "UNKNOWN", reason: `${SOURCE_FAILED} could not open a browser tab` };
    }
    try {
      await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });
      await page.goto(withEnglish(review.googleReviewUrl), { waitUntil: "networkidle2", timeout: timeoutMs });
      // The review (or the removal message) is drawn after the network settles; give it a moment.
      await page
        .waitForFunction((removed) => {
          const t = document.body?.innerText.toLowerCase() ?? "";
          return t.includes(removed) || / ago\b/.test(t);
        }, { timeout: 10_000 }, REMOVED_TEXT)
        .catch(() => undefined);
      const text = await page.evaluate(() => document.body?.innerText ?? "");
      const result = classifyPage(text, review.reviewerName);
      logger.info({ reviewId: review.id, status: result.status }, "scrape check");
      return result;
    } catch (e) {
      return { status: "UNKNOWN", reason: `${SOURCE_FAILED} the review page did not load (${(e as Error).message})` };
    } finally {
      await page.close().catch(() => undefined);
      release();
    }
  }
}

/**
 * Asks Google for the English page, so the removal message is in the wording we look for. Only
 * on google.com links: a maps.app.goo.gl short link is left exactly as it is (the browser's
 * English language setting covers where it redirects to).
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
