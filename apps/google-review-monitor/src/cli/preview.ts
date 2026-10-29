// Dashboard preview with fake data. It runs in its own throwaway database on the same MySQL
// server (created now, dropped when the preview stops), so it never touches the real data or
// any API. The MySQL account needs CREATE and DROP rights.
import { config } from "../config";
import { migrate } from "../db/db";
import { ReviewRepo } from "../db/repo";
import { createScratchDb } from "../db/scratch";
import { createApp } from "../server/app";

const scratch = await createScratchDb(config.databaseUrl(), "grm_preview");
const db = scratch.db;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => void scratch.drop().finally(() => process.exit(0)));
}
await migrate(db);
const repo = new ReviewRepo(db);

const people = ["John Smith", "Mary Jones", "Robert Lee", "Amina Yusuf", "Peter Kamau", "Sarah Wilson", "David Otieno", "Grace Wanjiru"];
const texts = [
  "Terrible service, waited over an hour and nobody apologised. Would not recommend.",
  "Rude staff and the place was dirty.",
  "Overcharged me and refused a refund.",
  "Not what was advertised.",
  "Never again.",
  "Slow and disorganised.",
  "Manager was dismissive when I raised a problem.",
  "Food arrived cold.",
];
const locations = ["Location A", "Location B", "Location C"];
const months = ["September", "October"];
const projectGids = ["demo-sep-project", "demo-oct-project"];

for (const [i, name] of people.entries()) {
  await repo.upsertDiscovered({
    asanaTaskId: String(1000 + i),
    asanaTaskName: `Review by ${name}`,
    asanaTaskUrl: `https://app.asana.com/0/1/${1000 + i}`,
    asanaProjectGid: projectGids[i % 2],
    location: locations[i % 3],
    month: months[i % 2],
    // Each location has someone on it; a few disputes are assigned to someone else.
    assigneeName: i % 4 === 1 ? "Priya Nair" : null,
    locationAssigneeName: ["Daniel Okoro", "Lena Fischer", null][i % 3],
    reviewerName: name,
    rating: (i % 5) + 1,
    reviewText: texts[i],
    googleReviewUrl: `https://www.google.com/maps/reviews/data=!4m8!${i}`,
    taggedRemoved: false,
  });
}

const all = await repo.listToCheck();
for (const [i, r] of all.entries()) {
  await repo.recordCheck(r, { status: "REVIEW_EXISTS" });
  if (i < 2) await repo.recordCheck(r, { status: "REVIEW_REMOVED" });
  if (i === 2) await repo.recordCheck(r, { status: "UNKNOWN", reason: "Google rate limited (HTTP 429)" });
}
await repo.markNotified([all[0].id], true); // first removal notified, second still pending

// Spread history rows over a few days so "Recent activity" has more than just today in the demo.
const { rows: historyRows } = await db.query<{ id: number }>("SELECT id FROM review_check_history ORDER BY id");
for (const [i, row] of historyRows.entries()) {
  const daysAgo = i % 3;
  if (daysAgo > 0) await db.query(`UPDATE review_check_history SET checked_at = now(3) - INTERVAL ${daysAgo} DAY WHERE id = $1`, [row.id]);
}

// A few audit entries so the Audit page has something to show.
for (const [actor, action, summary] of [
  ["system", "system.interrupted", "App started and released 1 check that a restart had interrupted"],
  ["demo", "settings.changed", "Google reviews per location changed from 200 to 500"],
  ["demo", "run.started", "Started a check of October"],
  ["demo", "run.finished", "Check of October finished: 4 reviews checked, 1 removed, 0 could not be checked; removal alert sent"],
  ["demo", "location.checked", "Checked Location A: 1 review — 1 still available, 0 removed, 0 could not be checked"],
  ["demo", "google.loaded", "Loaded the latest Google reviews for Location B"],
  ["scheduler", "daily.started", "Daily check started"],
  ["scheduler", "daily.finished", "Daily check finished"],
]) {
  await repo.addAudit({ actor, action, summary });
}

createApp({ repo, user: "demo", password: "demo", scheduleCron: "0 7 * * *", timezone: "Africa/Maputo" }).listen(3100, () =>
  console.log("Preview at http://localhost:3100  (login: demo / demo)"),
);
