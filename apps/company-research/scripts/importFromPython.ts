// One-time move from the original Python app: copies its SQLite database (data/research.db) and its
// Settings page choices (config/settings.json, config/providers.json) into the hub's MySQL
// database, keeping every id. Search API keys in its .env that the hub's .env lacks are appended
// to the hub's .env (values are never printed).
//
//   npm run company-research:import-python -- [path to the Python project]   (default ../Zawadie)
//
// Refuses to run when Lead Generation data already exists in MySQL, so it cannot overwrite anything.
import "dotenv/config";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ConfigStore, SettingsSchema } from "../src/config";
import { createDb, migrate } from "../src/db/db";
import { insertRow } from "../src/db/repo";
import { databaseUrl } from "../src/hub";

const HUB_ROOT = process.cwd();
const source = path.resolve(process.argv[2] ?? path.join(HUB_ROOT, "..", "Zawadie"));
const sqliteFile = path.join(source, "data", "research.db");
if (!existsSync(sqliteFile)) throw new Error(`No database found at ${sqliteFile}`);

// Parents before children, so foreign keys are satisfied as rows arrive.
const TABLES: [from: string, to: string, dates: string[], json: string[]][] = [
  ["companies", "cr_companies", ["date_researched", "created_at", "updated_at"], ["field_confidence"]],
  ["email_jobs", "cr_email_jobs", ["created_at", "updated_at"], ["pending_items"]],
  ["email_verifications", "cr_email_verifications", ["verified_at", "created_at"], ["provider_raw", "input_row"]],
  ["discovered_emails", "cr_discovered_emails", ["created_at", "updated_at"], ["input_row"]],
  ["search_results", "cr_search_results", ["searched_at"], []],
  ["research_logs", "cr_research_logs", ["timestamp"], []],
  ["evidence", "cr_evidence", [], []],
  ["review_queue", "cr_review_queue", ["created_at"], ["conflicting_information"]],
];

/** SQLAlchemy stores naive UTC datetimes as "YYYY-MM-DD HH:MM:SS[.ffffff]". */
const toDate = (value: unknown) => (typeof value === "string" && value ? new Date(value.replace(" ", "T") + "Z") : null);

const sqlite = new DatabaseSync(sqliteFile, { readOnly: true });
const present = new Set((sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name));

const db = createDb(databaseUrl());
await migrate(db);
const [{ n }] = await db.query<{ n: number }>("SELECT (SELECT COUNT(*) FROM cr_companies) + (SELECT COUNT(*) FROM cr_discovered_emails) + (SELECT COUNT(*) FROM cr_email_verifications) AS n");
if (Number(n) > 0) {
  console.error("Lead Generation data already exists in MySQL — nothing was imported.");
  await db.end();
  process.exit(1);
}

await db.transaction(async (tx) => {
  for (const [from, to, dates, jsonColumns] of TABLES) {
    if (!present.has(from)) continue;
    const rows = sqlite.prepare(`SELECT * FROM ${from} ORDER BY id`).all() as Record<string, unknown>[];
    for (const row of rows) {
      for (const column of dates) row[column] = toDate(row[column]);
      for (const column of jsonColumns) if (typeof row[column] === "string") row[column] = JSON.parse(row[column] as string);
      await insertRow(tx, to, row);
    }
    console.log(`${from}: ${rows.length} row(s)`);
  }
});

// Settings page choices.
const config = new ConfigStore(db);
const readJson = (file: string) => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null);
const settings = readJson(path.join(source, "config", "settings.json"));
if (settings) {
  await config.saveSettings(SettingsSchema.parse(settings));
  console.log("settings.json: imported");
}
const providers = readJson(path.join(source, "config", "providers.json"));
if (providers) {
  await config.saveProvidersConfig(providers);
  console.log("providers.json: imported");
}
await db.end();

// API keys: append the ones the hub's .env does not have yet.
const KEY_NAMES = ["GOOGLE_API_KEY", "GOOGLE_SEARCH_ENGINE_ID", "BING_API_KEY", "BING_ENDPOINT", "SERPAPI_KEY", "BRAVE_API_KEY", "HUNTER_API_KEY", "EMAIL_VERIFICATION_API_KEY"];
const parseEnv = (file: string) =>
  new Map(
    (existsSync(file) ? readFileSync(file, "utf8") : "")
      .split(/\r?\n/)
      .map((line) => /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line))
      .filter((m): m is RegExpExecArray => Boolean(m))
      .map((m) => [m[1], m[2]]),
  );
const theirs = parseEnv(path.join(source, ".env"));
const hubEnvFile = path.join(HUB_ROOT, ".env");
const ours = parseEnv(hubEnvFile);
const added = KEY_NAMES.filter((k) => theirs.get(k) && !ours.has(k));
if (added.length) {
  appendFileSync(hubEnvFile, `\n# ---- Lead Generation (apps/company-research) ----\n${added.map((k) => `${k}=${theirs.get(k)}`).join("\n")}\n`);
  console.log(`API keys added to the hub .env: ${added.join(", ")}`);
}
console.log("Done.");
