// Cron worker for the automatic local research (community, demographics, schools, events, culture).
// The web app only queues stores; this script does the slow OpenAI work so no web request has to wait for it.
//
// hPanel > Advanced > Cron Jobs (custom), every 5 minutes. Cron runs in UTC, is capped at 30 minutes and does not load .env
// for you, so this script reads the .env next to the app itself. Example command (adjust the path to your Node.js site):
//   cd /home/<user>/domains/<domain>/nodejs && /usr/bin/node scripts/runResearch.js >> research.log 2>&1
//
// Each run: re-queues stores whose research is older than the active playbook, then researches queued stores one at a
// time (about 25 minutes at most). Only one run works at a time; a run that finds another one busy exits straight away.
// Locally: `npm run research`. (In development the web app also runs it for you right after you add a store.)
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });

const { default: pool } = await import('../src/config/db.js');
const { processQueue } = await import('../src/services/localResearchService.js');

try {
  const r = await processQueue();
  console.log(`[research] ${new Date().toISOString()} ${r.skipped ? 'another worker is already running, nothing to do' : `done ${r.done}, failed ${r.failed}, re-queued ${r.queuedStale} for the new playbook`}`);
} catch (err) {
  console.error('[research] worker failed:', err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
