import { migrate } from "../db/db";
import { runCycle } from "../monitor/cycle";
import { applyStored } from "../settings";
import { buildChecker, buildDeps } from "../wiring";

const { db, repo, deps } = buildDeps();
await migrate(db);
applyStored(await repo.getSettings());
const r = await runCycle({ ...deps, checker: buildChecker() });
await db.end();
process.exit(r.ok ? 0 : 1);
