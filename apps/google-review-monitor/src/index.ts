// Standalone entry (own port, own sign-in). Inside the hub, src/hub.ts is used instead.
import { migrate } from "./db/db";
import { startDashboard } from "./server/start";
import { buildDeps } from "./wiring";

const built = buildDeps();
await migrate(built.db);
await startDashboard(built.repo);
