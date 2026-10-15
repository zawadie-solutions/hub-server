// Entry used by the Zawadie hub (hub-server/server.js): sets up the database and the daily
// check, then hands back the dashboard as an Express app for the hub to mount at its path.
// The hub has already signed the person in, so the dashboard trusts its session.
import type express from "express";
import { migrate } from "./db/db";
import { startScheduler } from "./scheduler";
import { buildDashboard } from "./server/start";
import { buildDeps } from "./wiring";

export async function createSolution(opts: { userOf: (req: express.Request) => string | null; signOutPath: string }) {
  const built = buildDeps();
  await migrate(built.db);
  startScheduler(built);
  return buildDashboard(built.repo, opts);
}
