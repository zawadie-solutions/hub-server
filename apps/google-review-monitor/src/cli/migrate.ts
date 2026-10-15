import { createDb, migrate } from "../db/db";

const db = createDb();
await migrate(db);
console.log("Schema is up to date.");
await db.end();
