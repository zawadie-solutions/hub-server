// Dashboard only. Checks run from the dashboard, or with `run-once` from the command line.
import { createDb, migrate } from "../db/db";
import { ReviewRepo } from "../db/repo";
import { startDashboard } from "../server/start";

const db = createDb();
await migrate(db);
await startDashboard(new ReviewRepo(db));
