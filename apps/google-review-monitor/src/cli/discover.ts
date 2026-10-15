// Phase 1 discovery: prints the real Asana structure and what would be extracted. Read-only, no DB.
import { AsanaClient } from "../asana/client";
import { toDiscovered, walkProject } from "../asana/sync";
import { config } from "../config";

const a = config.asana();
const walked = await walkProject(new AsanaClient(a.token), a, {
  onProgress: (scanned) => process.stderr.write(`\rscanned ${scanned} tasks...`),
});
process.stderr.write("\r" + " ".repeat(40) + "\r");

console.log(`Scanned ${walked.length} tasks (maxDepth=${a.maxDepth}). Path = [section, task, subtask...]\n`);
let reviews = 0;
let withoutLink = 0;
for (const w of walked) {
  const d = toDiscovered(w, a);
  if (d) {
    reviews++;
    console.log(`${w.path.join(" / ")}\n  [REVIEW] month=${d.month} location=${d.location} reviewer=${d.reviewerName ?? "?"} rating=${d.rating ?? "?"}\n  ${d.googleReviewUrl}`);
  } else if (w.task.notes?.trim()) {
    withoutLink++;
  }
}
console.log(`\n${reviews} review tasks with a Google link; ${withoutLink} other tasks have a description but no Google link.`);
console.log("If month/location look wrong, adjust ASANA_MONTH_INDEX / ASANA_LOCATION_INDEX / ASANA_MAX_DEPTH.");
