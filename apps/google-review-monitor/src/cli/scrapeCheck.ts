// Tries scrape mode on review links without touching the database:
//   npm run monitor:scrape-check -- <review link> [<review link> ...] [--reviewer "Jane Doe"]
// Goes through the scraper API set by SCRAPE_API_URL + SCRAPE_API_SECRET.
import { config } from "../config";
import { ScrapeChecker } from "../google/scrapeChecker";

const args = process.argv.slice(2);
const at = args.indexOf("--reviewer");
const reviewerName = at >= 0 ? (args[at + 1] ?? null) : null;
const urls = args.filter((a, i) => a.startsWith("http") && !(at >= 0 && i === at + 1));
if (!urls.length) {
  console.error('Usage: npm run monitor:scrape-check -- <review link> [...] [--reviewer "Name"]');
  process.exit(1);
}

const opts = config.scrape();
console.log(`Scrape mode: scraper API (${new URL(opts.apiUrl).host})`);
const checker = new ScrapeChecker(opts);
for (const [i, url] of urls.entries()) {
  const started = Date.now();
  const result = await checker.checkReview({ id: -(i + 1), googleReviewUrl: url, location: null, reviewerName, rating: null });
  console.log(`${result.status}${result.status === "UNKNOWN" ? ` (${result.reason})` : ""}  ${((Date.now() - started) / 1000).toFixed(1)}s  ${url}`);
}
process.exit(0);
