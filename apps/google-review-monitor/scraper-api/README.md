# Review scraper API

Renders a Google review link in headless Chrome and returns the page's visible text, so Google Review Monitor's **scrape mode** works on hosting that can't run Chrome (Hostinger). The monitor decides what the text means (removed / exists / unknown); this API only renders.

It is a **separate Vercel project** that happens to live in this repo. The hub never installs or runs it: it has its own `package.json` (no npm workspaces), it is not in `solutions.js`, and the hub's `npm test` / `npm run typecheck` skip it.

## API

`POST /api/render`, header `Authorization: Bearer <SCRAPER_API_SECRET>`, body `{ "url": "<review link>" }`

| Status | Body | When |
|---|---|---|
| 200 | `{ "finalUrl": "...", "text": "..." }` | Rendered (text is capped at 20 KB) |
| 400 | `{ "error": "..." }` | Not a Google review link (only `https://maps.app.goo.gl/...` and `https://google.<tld>/maps...` are allowed) |
| 401 | `{ "error": "Not authorized" }` | Wrong/missing secret, or no secret configured |
| 405 | | Not a POST |
| 502 | `{ "error": "..." }` | The page could not be rendered (timeout, Chrome failed) |

Chrome comes from [`@sparticuz/chromium`](https://github.com/Sparticuz/chromium) (a compressed Chromium for serverless). Its version must match `puppeteer-core`'s Chrome: **153.0.0 ↔ puppeteer-core 25.11.0**. Upgrade them together.

## Deploy to Vercel

1. In Vercel: **Add New → Project**, import the `hub-server` GitHub repo.
2. **Root Directory**: `apps/google-review-monitor/scraper-api` (Edit → pick the folder). Framework preset: **Other**. Leave build/output settings empty.
3. **Node.js version**: 22.x (Project → Settings → General; also set by `engines` in package.json).
4. **Environment variable**: `SCRAPER_API_SECRET` = a long random string (e.g. `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`). Keep it secret.
5. **Ignored Build Step** (Project → Settings → Git), so commits that only touch the hub don't redeploy this:
   ```
   git diff --quiet HEAD^ HEAD -- .
   ```
   (runs inside the Root Directory, so `.` is this folder; exit 0 = skip the build.)
6. Deploy. The endpoint is `https://<project>.vercel.app/api/render`.

`vercel.json` gives the function 2 GB memory and 60 s per request, and bundles Chromium's files. Check these against your Vercel plan's current limits.

## Point the monitor at it (hub `.env` on Hostinger)

```
SCRAPE_API_URL=https://<project>.vercel.app/api/render
SCRAPE_API_SECRET=<the same secret as on Vercel>
```

With these set, scrape mode uses the API; without them it uses a locally installed Chrome. Then choose **Scrape mode** under Configure → Review source.

## Check it works before relying on it

From the hub folder:

```
npm run monitor:scrape-check -- https://maps.app.goo.gl/XXXX     # one or more links, prints the verdict
npm run monitor:scrape-pilot -- 100                               # 100 random links from the database
```

Neither saves anything or sends alerts. The pilot prints how many came back EXISTS / REMOVED / UNKNOWN and why. If most are UNKNOWN with "consent or unusual traffic page", Google is blocking Vercel's servers.

## Develop locally

```
npm install
npm test
npm run typecheck
# render real links with a locally installed Chrome (the serverless Chromium is Linux-only):
LOCAL_CHROME_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe" npx tsx scripts/try-local.ts <link>
# run the API on http://localhost:3999/api/render:
LOCAL_CHROME_PATH="..." SCRAPER_API_SECRET=dev-secret npx tsx scripts/serve-local.ts
```
