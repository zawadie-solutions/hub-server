// Renders review links with the API's own code, using a locally installed Chrome:
//   LOCAL_CHROME_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe" npx tsx scripts/try-local.ts <link> [...]
import { renderReviewPage } from "../lib/render.js";

for (const url of process.argv.slice(2)) {
  const started = Date.now();
  try {
    const { finalUrl, text } = await renderReviewPage(url);
    const removed = text.toLowerCase().includes("this review is no longer available");
    console.log(`${removed ? "REMOVED MESSAGE" : "no removal message"}  ${text.length} chars  ${((Date.now() - started) / 1000).toFixed(1)}s  ${url}`);
    console.log(`  -> ${finalUrl.slice(0, 100)}`);
  } catch (e) {
    console.log(`ERROR ${(e as Error).message}  ${url}`);
  }
}
process.exit(0);
