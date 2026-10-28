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

## Admin portal
Open `http://localhost:3000/` (or `/admin`). Behind the Zawadie Hub there is no second sign-in: set `ZAWADIE_SSO_SECRET` to the hub's value and hub admins go straight in (any other hub user with this project gets the marketing planner). Opened directly, sign in with `ADMIN_API_KEY`. From there you can upload a quarterly playbook (live progress: upload, extract, embed, active), switch the active playbook, review and edit each store's local knowledge, and run test prompts that show exactly which chunks were retrieved. Source: `public/index.html`, `public/css/style.css`, `public/js/app.js`.

## Marketing planner (`/ask`)

A separate page for the marketing team. Hub users with access to this project open it without a code; opened directly they sign in with `TEAM_ACCESS_KEY` (different from the admin key). They pick a store from a dropdown, ask a question, and get a structured plan: who to target, playbook campaign rules, local store plays and a heads-up, with Copy plan and Regenerate. Rate limited to 20 questions per 10 minutes per IP; 8 wrong codes lock that IP out for 15 minutes. Set `TEAM_ACCESS_KEY` in `.env` (and in hPanel when deployed) and share it with the team. Source: `public/ask.html`, `public/js/ask.js`, `src/controllers/askController.js`.

Stores are added from the admin page (**+ Add store**). Store name, street address, city, state and ZIP are all required. The store appears in the planner immediately, and it is queued so the AI can research its **community, demographics, schools, local events and culture** (live web search when the OpenAI account allows it, otherwise the model's own knowledge) and saves the results as local knowledge. Entries written this way are marked **AI** and list the web sources they came from; an admin checks them and clicks **Mark as reviewed** (it records who and when). **Re-run research** replaces only the AI entries (reviewed ones too); entries added by hand are kept. A store's details can be changed with **Edit details** (optionally re-running the research) and a store can be deleted along with its local knowledge. Two stores may share a city, but not the same name in the same city. When a new playbook goes live, stores whose research is older than it are queued again automatically (set `AUTO_RESEARCH_REFRESH=off` to disable). The research itself runs in a cron job, see below. `OPENAI_RESEARCH_MODEL` optionally picks the research model (default: `OPENAI_CHAT_MODEL`). The database is updated automatically on start (`src/config/migrate.js`; the same SQL is in `database/migrations/002_auto_research.sql`).



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
