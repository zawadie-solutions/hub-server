// On-demand check: syncs one Asana project (one month) and, if Google credentials are
// configured, checks each of its reviews against Google. If this isn't the month the daily
// 07:00 job is currently configured for (ASANA_PROJECT_GID), every review this run touches
// is taken out of that daily cycle afterward, so a historical look-back never grows the
// automated job's workload. Running this for the *current* month (e.g. to check early)
// leaves monitoring active, same as the live daily job would. The same logic
// (src/monitor/runMonth.ts) backs the dashboard's "Run now" button, so behaviour matches.
import { parseArgs } from "node:util";
import { AsanaClient } from "../asana/client";
import { config } from "../config";
import { createDb, migrate } from "../db/db";
import { ReviewRepo } from "../db/repo";
import { runMonthCheck } from "../monitor/runMonth";
import { applyStored } from "../settings";
import { buildChecker, buildNotifier } from "../wiring";

const { values } = parseArgs({
  options: { project: { type: "string" }, notify: { type: "boolean", default: false } },
});
if (!values.project) {
  console.error("Usage: npm run check-month -- --project <asana project gid> [--notify]");
  process.exit(1);
}

const db = createDb();
await migrate(db);
const repo = new ReviewRepo(db);
applyStored(await repo.getSettings());
const a = config.asana();
const client = new AsanaClient(a.token);
const projectGid = values.project;

const project = await client.getProject(projectGid);
const claimed = await repo.tryStartAsanaRun(projectGid, project.name);
if (!claimed) {
  console.error(`A run is already in progress for "${project.name}" (started via the dashboard or another check-month run).`);
  await db.end();
  process.exit(1);
}

let checker = null;
try {
  checker = buildChecker();
} catch (e) {
  console.log(`Google credentials not configured (${(e as Error).message}) — will sync only.`);
}

try {
  const result = await runMonthCheck({
    projectGid,
    client,
    asanaSettings: a,
    repo,
    checker,
    notifier: values.notify ? buildNotifier() : null,
    checkDelayMs: config.checkDelayMs,
    removalRecheckDelayMs: config.removalRecheckDelayMs,
    retireAfterRun: projectGid !== a.projectGid,
    onProgress: (msg) => console.log(msg),
  });
  await repo.finishAsanaRun(projectGid, { ok: true, reviewCount: result.reviewsFound });

  console.log(
    result.checkedGoogle
      ? `Done. ${result.removed} review(s) found removed, ${result.unknown} unknown.${result.notified ? " Notification sent." : values.notify ? "" : " (not notifying — pass --notify to send one)"}`
      : "Synced only — add GOOGLE_OAUTH_* to .env to actually check reviews.",
  );
  console.log("Results are in the dashboard, filtered to this month.");
} catch (e) {
  await repo.finishAsanaRun(projectGid, { ok: false, error: (e as Error).message });
  throw e;
} finally {
  await db.end();
}
