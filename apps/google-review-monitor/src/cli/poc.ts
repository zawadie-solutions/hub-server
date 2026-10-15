// Proof of concept: check one review against Google.
// Usage: npm run poc -- --url <google review url> --location "Location A" --reviewer "John Smith"
import { parseArgs } from "node:util";
import { buildChecker } from "../wiring";

const { values } = parseArgs({
  options: { url: { type: "string" }, location: { type: "string" }, reviewer: { type: "string" } },
});
if (!values.url || !values.location || !values.reviewer) {
  console.error('Usage: npm run poc -- --url <url> --location "<Asana location>" --reviewer "<name>"');
  process.exit(1);
}
const result = await buildChecker().checkReview({
  id: 0,
  googleReviewUrl: values.url,
  location: values.location,
  reviewerName: values.reviewer,
  rating: null,
});
console.log(result);
