# Lead Generation

Turns a list of company names into evidence-backed lead records (website, owner, decision maker, phone, email) and adds Domain Search, Find Email by Company/Name and Email Verification, with Excel export.

Shown in the hub as **Lead Generation** (it was called Company Research before). The folder, the `/company-research/` URL, the `cr_` tables and the `COMPANY_RESEARCH_*` settings keep their old names, so existing data, access and `.env` files keep working.

This is the Node/TypeScript port of the original Python/FastAPI app (the `Zawadie` repo). It runs **inside the hub**: `npm start` in the hub root serves it at `/company-research/`, behind the hub's login. The API routes and JSON are the same as the Python version, so the React UI in `frontend/` is unchanged.

## How it fits together

| Path | What it is |
|---|---|
| `src/hub.ts` | Entry the hub loads: connects to MySQL, creates the tables, returns the app |
| `src/server/app.ts` | The REST API (`/api/*`) and the built UI (`frontend/dist`) |
| `src/research/engine.ts` | The per-company research workflow; `jobManager.ts` runs it in the background |
| `src/research/*` | Identification, owner/contact research, extraction, scoring, email research |
| `src/providers/*` | Search providers (Google, Bing, SerpAPI, Brave, Demo) and email providers (Hunter, ZeroBounce, built-in verifier, Demo) |
| `src/db/schema.sql` | Tables, all prefixed `cr_` |
| `frontend/` | React UI (Vite). `dist/` is committed so a deploy needs no build step |

## Configuration (the hub's `.env`)

- `COMPANY_RESEARCH_DATABASE_URL`: MySQL database for this app. When unset, the hub's `DATABASE_URL` is used (tables are prefixed `cr_`, so they can share it).
- Search keys: `SERPAPI_KEY`, `GOOGLE_API_KEY` + `GOOGLE_SEARCH_ENGINE_ID`, `BRAVE_API_KEY`, `BING_API_KEY` (+ optional `BING_ENDPOINT`). With none set, the app runs in **Demo Mode** with clearly labelled simulated data.
- Email keys (optional): `HUNTER_API_KEY` (discovery + verification), `EMAIL_VERIFICATION_API_KEY` (ZeroBounce). Without them, discovery falls back to web search and verification to the free built-in checks.
- `COMPANY_RESEARCH_DATA_DIR`: where Excel exports are written (default `data/company-research/`).

Keys entered on the app's Settings page are saved in the database (`cr_config`) and take precedence over the `.env` values. Settings and the provider choice are stored there too, so they survive a redeploy. On first start the provider choice comes from `config/providers.json`.

## Commands (from the hub root)

- `npm test`: tests (database tests need `TEST_DATABASE_URL=mysql://user:pass@host:3306`, an account allowed to create and drop databases)
- `npm run typecheck`
- `npm run company-research:import-python -- <path to the Python project>`: one-time copy of the Python app's `research.db`, settings and API keys into the hub. Refuses to run if data already exists.
- `npm run company-research:build-ui`: rebuild `frontend/dist` after changing the React code
