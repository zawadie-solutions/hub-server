# Google Review Monitor

> **Part of the Zawadie hub.** This app runs inside hub-server: `npm start` in the hub root starts the hub, this dashboard (at `/google-review-monitor/`, behind the hub's login) and the daily check together. Settings go in the hub's `.env` (no `PORT` / `DASHBOARD_*` needed), and dependencies are in the hub's `package.json`. The CLI tools are the hub's `npm run monitor:*` scripts, and the tests run with `npm test` from the hub root. The entry point is `src/hub.ts`; `src/index.ts` still runs it standalone. Where the rest of this README says `npm run <x>`, use `npm run monitor:<x>` from the hub root.

A daily job (07:00 CAT) that reads Google review links from Asana, checks whether each review still exists, and **notifies Vanessa once** when a review has disappeared — as a Slack DM if `SLACK_BOT_TOKEN` is set, otherwise by email. A small read-only dashboard (sign-in form, needs `DASHBOARD_PASSWORD`) is a monitoring panel, not a review-management tool: three counts (monitored / still available / removed), the last and next check times, which reviews are currently flagged as removed (with a link to the Asana task), and a short daily activity feed. `npm start` runs scheduler + dashboard, `npm run dashboard` runs the dashboard alone, `npm run preview` shows it with fake data on http://localhost:3100 (demo / demo).

```
Asana -> Google URL -> checkReview() -> EXISTS: silent | UNKNOWN: log, retry tomorrow | REMOVED: notify once (Slack DM or email)
```

## Setup
1. `npm install`, create an empty MySQL 8 database (`CREATE DATABASE google_review_monitor`), copy `.env.example` to `.env` and fill it in (never commit `.env`). `DATABASE_URL` is `mysql://user:password@host:3306/database`; URL-encode special characters in the password (`#` -> `%23`) and quote the value.
2. `npm run migrate` creates the tables.
3. `npm run discover` prints the Asana project tree and what it extracts. Adjust `ASANA_MONTH_INDEX` / `ASANA_LOCATION_INDEX` / `ASANA_MAX_DEPTH` until month and location are right. Any task whose description holds a Google Maps/review link is a review task; `Reviewer: Name` and `Rating: N` lines in the description are used when present.
4. Copy `config/locations.example.json` to `config/locations.json` (Asana location name -> Business Profile `accounts/…/locations/…`).
5. `npm run poc -- --url <url> --location "Location A" --reviewer "John Smith"` on one live and one removed review before trusting it.
6. `npm run run-once` does one full cycle (exit code 1 if any stage failed). `npm start` keeps a process running that does it daily at 07:00 `Africa/Maputo` (CAT, UTC+2, no DST). Alternatively schedule `npm run run-once` with Windows Task Scheduler.

## Months
Each month is a separate Asana project (separate `ASANA_PROJECT_GID`). The daily 07:00 job only ever syncs/checks/notifies for the one project currently in `.env` — the current month, by design, so the automated job's workload doesn't grow every time a new month starts.

To look back at an older month on demand (e.g. "did that review from two months ago ever get removed?"), run `npm run check-month -- --project <that month's Asana project gid> [--notify]`. It syncs and checks just that project, then marks every review it touched as no longer part of the daily cycle — so a look-back never bloats the automated job. Results land in the DB and show up in the dashboard's month picker (only shown once more than one month has been synced); pass `--notify` to actually send a Slack DM/email for anything it finds removed, which is off by default since a stale dispute resurfacing shouldn't page Vanessa the way a fresh one should.

## Rules that prevent false alerts
- `REVIEW_REMOVED` only if Google's review listing for the location is complete **and** the reviewer is absent **and** a second check a minute later agrees. Anything else (HTTP error, rate limit, auth, timeout, incomplete listing, bad URL, unmapped location, missing reviewer name) is `UNKNOWN`: logged, no email, retried next run.
- One digest notification for newly removed reviews only. `notification_sent` is set only after the send succeeds; a failed send is retried next run. A review is notified once, then no longer checked (`KEEP_CHECKING_REMOVED=true` to keep checking; a reappearing review resets its state).
- The Asana sync reads everything before writing, so an Asana failure leaves existing records untouched.

## Limits
Uses the Google Business Profile API, which only works for locations the authorised Google account manages, and matches by reviewer display name (Asana has no review ID). A renamed reviewer could look removed. Not yet verified against live Google/Asana — only mocked tests (`npm test`). Pilot against manual checks first. Run a single instance. If an email is sent but the DB write then fails, a duplicate is possible.

Set `REVIEW_CHECKER=places` and `GOOGLE_PLACES_API_KEY` to check with the Places API (New) instead: no access to the business profile needed, the place is found from the Asana location name and confirmed against the CID in the review link, and the review is matched by its ID or reviewer name. Places returns at most 5 reviews per place, so a review it does not return is `UNKNOWN` unless the place has no more reviews than were returned.

Set `REVIEW_CHECKER=apify` and `APIFY_TOKEN` to check with Apify's Google Maps Reviews Scraper (`compass/google-maps-reviews-scraper`): it lists any business's reviews, newest first, and each review is matched by the ID in its Asana link. Apify bills per review scraped; the reviews-per-location setting on the dashboard caps how many of the newest reviews are scraped per place (0 = all). A review missing from a capped listing is `UNKNOWN`; `REVIEW_REMOVED` needs an uncapped listing covering at least 95% of the place's review count. One actor run per place, so a full month takes a while.

Set `REVIEW_CHECKER=dataforseo` with `DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD` to check with DataForSEO's Google Reviews API (Business Data API): same ID matching and the same rules as Apify, billed per 10 reviews from a prepaid balance. It is a queue, so a run posts the listing tasks for all its places first and then collects them; full runs use the standard queue (up to 45 minutes) unless `DATAFORSEO_PRIORITY=true`, single-location checks always use the priority queue (about a minute, double the price). The reviews-per-location setting on the dashboard caps the newest reviews listed per place (the API's limit is 4,490).

## Audit and Configure pages
The dashboard's **Audit** page lists who did what and when: checks started, finished, cancelled or failed, single-location checks, Google review loads, settings changes, and what the scheduler did (`audit_log` table, append-only). The **Configure** page changes, without a restart, the review source and its fallback, how many of the newest reviews are fetched per location for DataForSEO and Apify, DataForSEO's queue, and whether the automatic daily check runs. It also shows the live credit left with DataForSEO and Apify. A value saved there is stored in `app_settings` and overrides `.env` until **Reset to .env values** is pressed. Credentials are never editable there and stay in `.env`.

## Database
The app uses MySQL 8 (`mysql2`). Tables are created on startup. Text uses the `utf8mb4_0900_as_cs` collation, so names compare exactly, and times are stored as UTC.

- **Tests:** `npm test` needs `TEST_DATABASE_URL` pointing at a MySQL server (`mysql://user:password@host:3306`). Each test creates its own database and drops it afterwards, so the account needs CREATE and DROP rights.
- **Preview:** `npm run preview` also creates a throwaway database on the `DATABASE_URL` server and drops it when stopped with Ctrl+C.

## Signing in
The dashboard has a sign-in page (`DASHBOARD_USER` / `DASHBOARD_PASSWORD`). Signing in sets a signed, HttpOnly session cookie that lasts 7 days; **Log out** in the top bar clears it, and changing `DASHBOARD_PASSWORD` signs everyone out. Five wrong passwords from one address block further attempts for 10 minutes. Scripts can still send the username and password with HTTP Basic credentials on API calls.

## Run options
**Run options**, next to **Run now**, sets what the next run from the dashboard does: check all of the month's reviews, only the first N, or only the last N (in the order of the locations list; a location is never split, so N is rounded up to the end of its location), and how many of the newest Google reviews to look through per location for that run, in place of the Configure value. The month is always synced from Asana in full first. The choice is remembered in the browser and recorded with the run in the audit log. The automatic daily check always checks everything with the Configure values.

## Layout
`src/asana` sync · `src/google` checker (swap behind `ReviewChecker`) · `src/notify` Slack DM / email (swap behind `Notifier`) · `src/monitor/cycle.ts` the daily job · `src/db` schema + repo · `src/index.ts` scheduler
