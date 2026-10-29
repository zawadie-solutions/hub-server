// Entry used by the Zawadie hub (hub-server/server.js): sets up the database and the background
// jobs, then hands back the app for the hub to mount at /company-research. The hub has already
// signed the person in, so the app trusts its session.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type express from "express";
import { ConfigStore, ROOT } from "./config";
import { createDb, migrate } from "./db/db";
import { createApp } from "./server/app";

export function databaseUrl(): string {
  const url = process.env.COMPANY_RESEARCH_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("Set COMPANY_RESEARCH_DATABASE_URL (or DATABASE_URL) to a MySQL database for Lead Generation");
  return url;
}

export async function createSolution(opts: { userOf: (req: express.Request) => string | null; signOutPath: string }) {
  const db = createDb(databaseUrl());
  await migrate(db);
  const config = new ConfigStore(db);
  // First start: take the search-provider choice shipped with the app (config/providers.json).
  const shipped = path.join(ROOT, "config", "providers.json");
  const [stored] = await db.query("SELECT 1 FROM cr_config WHERE name = 'providers'");
  if (!stored && existsSync(shipped)) await config.saveProvidersConfig(JSON.parse(readFileSync(shipped, "utf8")));
  // Signing out is the hub's job: the UI's "Log out" posts to the hub's own /logout.
  return createApp({ db, config, userOf: opts.userOf });
}
