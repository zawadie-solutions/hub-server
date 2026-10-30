# BAM Local Agent System

RAG-based AI marketing planner that pairs the quarterly BAM Marketing Playbook with local demographics, school calendars and events for
Smyrna, GA (`smyrna-ga`) · Port Charlotte, FL (`port-charlotte-fl`) · Orem, UT (`orem-ut`).

Stack: Node.js 20/22 + Express, MySQL/MariaDB (`mysql2/promise`), OpenAI SDK (`text-embedding-3-small`, `gpt-4o-mini`). Rules: `docs/PROJECT_KNOWLEDGE_BASE.md`.

## Setup
1. Copy `.env.example` to `.env`, fill it in.
2. Import `database/schema.sql` into the database named in `DB_NAME`.
3. `npm install`, then `npm start`.
4. Load the playbook (CLI, no request limit): `npm run ingest -- "docs/Marketing Playbook Q2 2026.pdf" 2026-Q2`
   Add `--dry-run` to preview chunking without OpenAI/DB. Ingest is atomic: the new playbook goes live only after all chunks are stored.

## Settings (admin portal)
The app's root (`http://localhost:3000/`, or `/bam-local-agent/` in the hub) opens the marketing planner, which is the Home page for everyone. **Settings** (`/admin`) is linked from the planner for hub admins. Behind the Zawadie Hub there is no second sign-in: set `ZAWADIE_SSO_SECRET` to the hub's value and hub admins go straight in (any other hub user with this project is sent back to the planner). Opened directly, sign in with `ADMIN_API_KEY`. From there you can upload a quarterly playbook (live progress: upload, extract, embed, active), switch the active playbook, review and edit each store's local knowledge, and run test prompts that show exactly which chunks were retrieved.

**Only reviewed AI knowledge is used.** Local entries written by the automatic research are left out of every answer until someone clicks **Mark as reviewed** (Undo takes them out again); entries added by hand are used straight away. The rule is `USABLE_CHUNK_SQL` in `src/services/ragService.js`. The planner's store line shows how many local facts are in use and how many AI facts are waiting for review. Source: `public/index.html`, `public/css/style.css`, `public/js/app.js`.

## Event plans (Zawadie BAM Event Planning Framework)
Asking for an event plan ("Create a spring break event plan", "Generate an event playbook for a local school partner", "Host a Mother's Day make & take") returns an event playbook instead of a marketing plan: title, **What / When / Where / Who / Why / How Much**, **Next Steps for Coordination** and **Action Items Needed From Store**. Detection is automatic (see "What the agent can do" below); send `mode: "event_plan"` or `"marketing_plan"` with `POST /api/ask` or `/api/admin/query` to force one. Retrieval reserves more slots for the store's own local data (address, school breaks, community hubs) and merges them with the active playbook's key facts; dates are cross-referenced against local school calendars, and anything the context doesn't give (contact names, partner fees, future dates) comes back as `[Confirm with Store]` or `[TBD Partner]`, highlighted on the page. Both pages show the plan as a card with Copy, Print (prints only the plan; save as PDF from the print dialog) and Download (.txt). The admin sandbox also has **Copy Slack blocks**: the Block Kit JSON from `src/utils/slackFormatter.js` (`eventPlanBlocks`), ready to paste into Slack's Block Kit Builder or post with `chat.postMessage`.

## What the agent can do (`src/services/assistantService.js`)
Every request first goes through a small routing call (temperature 0, keyword fallback if it fails) that picks one of four answers:
- **event_plan** - the event playbook card above. Writing asked for in the same request ("...include a partner email draft for King Springs Elementary") is written *from the finished plan*, so names, dates and times match, and shown under the plan as **Draft(s) for this event** (included in Copy, Print and Download).
- **marketing_plan** - the structured marketing plan (who to target, playbook rules, local plays, heads-up).
- **content** - emails, social posts, texts, flyers, newsletters, press releases and letters, each as its own card with Copy (emails: Copy subject / Copy body). Missing details come back as `[bracketed placeholders]`, highlighted, with a "Before you send" checklist. One automatic rewrite pass fixes past dates presented as upcoming and filler openers ("I hope this message finds you well").
- **answer** - a direct answer to a question (school break dates, playbook goals, local facts), then the supporting points.

Each result ends with **Keep going** suggestions. The page sends its last result back as `previous` (`{ question, text }`, text capped at 4,000 characters) so a follow-up like "Write an Instagram post for this event" builds on it; the router decides whether the request actually refers to it. Send `mode: "content"` or `"answer"` to force those types too.

## Marketing planner (`/ask`)

A separate page for the marketing team. Hub users with access to this project open it without a code; opened directly they sign in with `TEAM_ACCESS_KEY` (different from the admin key). They pick a store from a dropdown, type a request, and get the matching result (see above), with Copy and Regenerate. Past requests are not kept on the page. A hub user without hub admin rights who opens the app's root is sent straight to the planner. Rate limited to 20 questions per 10 minutes per IP; 8 wrong codes lock that IP out for 15 minutes. Set `TEAM_ACCESS_KEY` in `.env` (and in hPanel when deployed) and share it with the team. Source: `public/ask.html`, `public/js/ask.js`, `src/controllers/askController.js`.

Stores are added from the admin page (**+ Add store**). Store name, street address, city, state and ZIP are all required. The store appears in the planner immediately, and it is queued so the AI can research its **community, demographics, schools, local events and culture** (live web search when the OpenAI account allows it, otherwise the model's own knowledge) and saves the results as local knowledge. Entries written this way are marked **AI** and each one lists the web pages it came from (links are checked when saved: made-up or dead links are removed, and with web search an entry with no source left is not saved); an admin checks them and clicks **Mark as reviewed** (it records who and when). **Re-run research** replaces only the AI entries (reviewed ones too); entries added by hand are kept. A store's details can be changed with **Edit details** (optionally re-running the research) and a store can be deleted along with its local knowledge. Two stores may share a city, but not the same name in the same city. When a new playbook goes live, stores whose research is older than it are queued again automatically (set `AUTO_RESEARCH_REFRESH=off` to disable). The research itself runs in a cron job, see below. `OPENAI_RESEARCH_MODEL` optionally picks the research model (default: `OPENAI_CHAT_MODEL`). The database is updated automatically on start (`src/config/migrate.js`; the same SQL is in `database/migrations/002_auto_research.sql`).



## Scheduled job: local research (Hostinger cron)
The web app never does the slow AI research itself (shared hosting has no always-on workers, and processes stop on restart). Adding a store or clicking **Research now** only marks it *pending*; `scripts/runResearch.js` does the work. In hPanel > Advanced > Cron Jobs add a custom job, **every 5 minutes**:

    cd /home/<user>/domains/<domain>/nodejs && /usr/bin/node scripts/runResearch.js >> research.log 2>&1

Cron runs in UTC with a 30 minute cap; the script reads the `.env` beside the app itself and stops starting new stores after about 25 minutes. Only one run works at a time (a database lock), so overlapping runs just exit. Each run also re-queues stores whose research is older than the active playbook and marks any store left "running" by a crashed run as failed (the admin page shows Try again). If a store stays queued for more than 15 minutes the admin page warns that the cron job may not be set up. Locally, run `npm run research` once, or just add a store: when `NODE_ENV` is not `production` (or `RESEARCH_IN_PROCESS=on`) the web app runs the worker for you right away.

## Admin API (header `x-admin-key: $ADMIN_API_KEY`)
- `POST /api/admin/playbooks` (multipart: `file`, `quarter`, `year`) - returns `202 { jobId }`; poll `GET /api/admin/jobs/:id` for progress. 100s budget; use `npm run ingest` for large playbooks
- `GET /api/admin/overview` - everything the portal shows; `DELETE /api/admin/knowledge/:id`
- `GET /api/admin/playbooks`, `POST /api/admin/playbooks/:id/activate`
- `POST /api/admin/stores` `{ name, address, city, state, zip }` (all required) - adds a store and starts the automatic local research; `POST /api/admin/stores/:id/research` re-runs it
- `PATCH /api/admin/stores/:id` `{ name, address, city, state, zip, research? }` - edit a store; `DELETE /api/admin/stores/:id` - delete it and its local knowledge
- `PATCH /api/admin/knowledge/:id/review` `{ reviewed: true|false }` - mark an AI entry as checked by a person
- `GET /api/session` - tells the pages whether the hub already signed the person in
- `POST /api/admin/knowledge` `{ location_id, chunk_type: community|demographic|school|event|culture, content, metadata }`
- `POST /api/admin/query` `{ location_id, question }` - test the RAG pipeline without the planner page

## Design notes
- Retrieval: active chunks that belong to the store or are shared (`location_id` NULL); cosine similarity computed in Node.
- All SQL is parameterized; OpenAI calls have a 60s timeout and planner/admin requests a 100s cap.
