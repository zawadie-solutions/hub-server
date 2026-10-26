import type { Browser } from "puppeteer-core";

/** Google's wording when a review has been taken down (also what the page is waited for). */
const REMOVED_TEXT = "no longer available";
/** Most text returned; a review page is a few KB, so this only guards against odd pages. */
const MAX_TEXT = 20_000;

export interface Rendered {
  finalUrl: string;
  text: string;
}

// One browser per warm function instance, reused across requests.
let browser: Promise<Browser> | null = null;

async function launch(): Promise<Browser> {
  const { default: puppeteer } = await import("puppeteer-core");
  // Local testing (e.g. `vercel dev` on Windows/macOS): use an installed Chrome, since the
  // serverless Chromium package only ships Linux binaries.
  const localChrome = process.env.LOCAL_CHROME_PATH;
  if (localChrome) return puppeteer.launch({ executablePath: localChrome, headless: true, args: ["--lang=en-US"] });
  const { default: chromium } = await import("@sparticuz/chromium");
  return puppeteer.launch({
    args: await puppeteer.defaultArgs({ args: [...chromium.args, "--lang=en-US"], headless: "shell" }),
    defaultViewport: { width: 1280, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false, isLandscape: true },
    executablePath: await chromium.executablePath(),
    headless: "shell",
  });
}

async function getBrowser(): Promise<Browser> {
  if (!browser) {
    browser = launch().catch((e) => {
      browser = null;
      throw e;
    });
  }
  const b = await browser;
  if (!b.connected) {
    browser = null;
    return getBrowser();
  }
  return b;
}

/** Opens the link like a person would and returns what the finished page says. */
export async function renderReviewPage(url: string, timeoutMs = 40_000): Promise<Rendered> {
  const b = await getBrowser();
  const page = await b.newPage();
  try {
    await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });
    await page.goto(url, { waitUntil: "networkidle2", timeout: timeoutMs });
    // Google Maps draws the review (or the removal message) after the network settles.
    await page
      .waitForFunction(
        (removed) => {
          const t = document.body?.innerText.toLowerCase() ?? "";
          return t.includes(removed) || / ago\b/.test(t);
        },
        { timeout: 10_000 },
        REMOVED_TEXT,
      )
      .catch(() => undefined);
    const text = await page.evaluate(() => document.body?.innerText ?? "");
    return { finalUrl: page.url(), text: text.slice(0, MAX_TEXT) };
  } finally {
    await page.close().catch(() => undefined);
  }
}
