// Pilot for scrape mode: runs N review links from the database through scrape mode and reports
// how many came back EXISTS / REMOVED / UNKNOWN, and why. Saves nothing and sends no alerts — it
// answers one question: does scrape mode get through to Google from where it runs?
//   npm run monitor:scrape-pilot -- [count=50]
import { config } from "../config";
import { createDb } from "../db/db";
import { ScrapeChecker } from "../google/scrapeChecker";

const count = Math.max(1, Math.min(Number(process.argv[2]) || 50, 1000));
const db = createDb();
// A spread of reviews (not just the newest) so one location doesn't dominate.
const { rows } = await db.query<{ id: number; google_review_url: string; reviewer_name: string | null; location: string | null }>(
  `SELECT id, google_review_url, reviewer_name, location FROM reviews WHERE google_review_url <> '' ORDER BY RAND() LIMIT ${count}`,
);
await db.end();

const opts = config.scrape();
console.log(`Scrape pilot: ${rows.length} reviews via the scraper API (${new URL(opts.apiUrl).host})\n`);
const checker = new ScrapeChecker(opts);
const tally = { REVIEW_EXISTS: 0, REVIEW_REMOVED: 0, UNKNOWN: 0 };
const reasons = new Map<string, number>();
const removed: string[] = [];
const started = Date.now();

for (const [i, row] of rows.entries()) {
  const result = await checker.checkReview({ id: row.id, googleReviewUrl: row.google_review_url, location: row.location, reviewerName: row.reviewer_name, rating: null });
  tally[result.status]++;
  if (result.status === "UNKNOWN") {
    // group "the scraper API answered HTTP 502 (Could not render: ...)" etc. by their gist
    const key = result.reason.replace(/\(.*\)$/, "").trim();
    reasons.set(key, (reasons.get(key) ?? 0) + 1);
  }
  if (result.status === "REVIEW_REMOVED") removed.push(`#${row.id} ${row.google_review_url}`);
  process.stdout.write(`\r${i + 1}/${rows.length}  exists ${tally.REVIEW_EXISTS}  removed ${tally.REVIEW_REMOVED}  unknown ${tally.UNKNOWN}   `);
}

const pct = (n: number) => `${((100 * n) / Math.max(1, rows.length)).toFixed(0)}%`;
console.log(`\n\nDone in ${((Date.now() - started) / 60000).toFixed(1)} min (${((Date.now() - started) / 1000 / Math.max(1, rows.length)).toFixed(1)} s per review)`);
console.log(`  REVIEW_EXISTS   ${tally.REVIEW_EXISTS}  (${pct(tally.REVIEW_EXISTS)})`);
console.log(`  REVIEW_REMOVED  ${tally.REVIEW_REMOVED}  (${pct(tally.REVIEW_REMOVED)})`);
console.log(`  UNKNOWN         ${tally.UNKNOWN}  (${pct(tally.UNKNOWN)})`);
if (reasons.size) {
  console.log("\nWhy UNKNOWN:");
  for (const [reason, n] of [...reasons].sort((a, b) => b[1] - a[1])) console.log(`  ${n}x  ${reason}`);
}
if (removed.length) {
  console.log("\nREMOVED (open these in a private window to confirm):");
  for (const r of removed) console.log(`  ${r}`);
}
process.exit(0);
