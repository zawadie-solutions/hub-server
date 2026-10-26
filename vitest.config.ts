import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The scraper API is its own Vercel project with its own dependencies and `npm test`;
    // the hub's test run (and its Hostinger install) never includes it.
    exclude: [...configDefaults.exclude, "apps/google-review-monitor/scraper-api/**"],
  },
});
