// Entry used by the Zawadie hub (hub-server/server.js): returns this app for the hub to mount at
// /bam-local-agent, running in the hub's own process instead of as a separate proxied server.
// Hub sign-in is trusted via the signed X-Zawadie-User-* headers (see src/middleware/auth.js);
// ADMIN_API_KEY/TEAM_ACCESS_KEY remain the fallback when this app is run standalone.
import cron from 'node-cron';
import fs from 'node:fs';
import dotenv from 'dotenv';

// This app's database and model settings, taken from its own .env (next to this file) when the hub's .env doesn't set
// them. Locally that lets the hub run this app with the same settings as `npm start` here; on Hostinger, where only the
// hub's environment exists, they must be set there. Only these keys: the app's PORT, NODE_ENV and access keys must
// never leak into the hub's process.
const OWN_SETTINGS = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME', 'OPENAI_CHAT_MODEL', 'OPENAI_EMBEDDING_MODEL', 'OPENAI_RESEARCH_MODEL'];
function loadOwnSettings() {
  const file = new URL('./.env', import.meta.url);
  if (!fs.existsSync(file)) return;
  const own = dotenv.parse(fs.readFileSync(file));
  for (const key of OWN_SETTINGS) if (!process.env[key] && own[key]) process.env[key] = own[key];
  // The hub's OPENAI_API_KEY belongs to the hub and its other apps, so this app's own key goes in under its own name
  // (read first by src/config/openai.js) instead of replacing it.
  if (!process.env.BAM_OPENAI_API_KEY && own.OPENAI_API_KEY) process.env.BAM_OPENAI_API_KEY = own.OPENAI_API_KEY;
}

export async function createSolution() {
  loadOwnSettings(); // before importing the app: its database pool reads these when it loads
  const { default: app } = await import('./src/app.js');
  const { processQueue } = await import('./src/services/localResearchService.js');

  // Built in: this app now lives inside the hub's own long-running process, the same as Google
  // Review Monitor (see apps/google-review-monitor/src/scheduler.ts) — so the automatic local
  // research queue (community/demographics/schools/events/culture) can run right here instead of
  // through a separate hPanel cron job calling scripts/runResearch.js. That script still works for
  // local/standalone use, but on Hostinger it has no way to read the hub's .env (it loads its own,
  // next to the app, which only exists when run standalone) and NODE_ENV=production there means
  // kickWorkerIfLocal() (dev-only immediate run) never fires either — so without this, a queued
  // store just sits on "pending" forever.
  const run = () => processQueue().catch((err) => console.error('[bam-local-agent] research worker failed:', err.message));
  cron.schedule('*/5 * * * *', run);
  run(); // also pick up anything already queued (e.g. from before a restart) without waiting up to 5 minutes

  return app;
}
