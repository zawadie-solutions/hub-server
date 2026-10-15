// Dashboard only (no scheduler). Useful when the daily job runs via Task Scheduler / `run-once`.
import { createDb, migrate } from "../db/db";
import { ReviewRepo } from "../db/repo";
import { startDashboard } from "../server/start";

const db = createDb();
await migrate(db);
await startDashboard(new ReviewRepo(db));
