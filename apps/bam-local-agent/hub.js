// Entry used by the Zawadie hub (hub-server/server.js): returns this app for the hub to mount at
// /bam-local-agent, running in the hub's own process instead of as a separate proxied server.
// Hub sign-in is trusted via the signed X-Zawadie-User-* headers (see src/middleware/auth.js);
// ADMIN_API_KEY/TEAM_ACCESS_KEY remain the fallback when this app is run standalone.
import cron from 'node-cron';

export async function createSolution() {
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
