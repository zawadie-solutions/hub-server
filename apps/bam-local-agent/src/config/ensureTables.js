// Creates BAM's tables the first time this app runs against a fresh database: applies
// database/schema.sql, whose statements are all idempotent (CREATE TABLE IF NOT EXISTS,
// INSERT IGNORE), so running this on every boot is safe and cheap once the schema already
// exists. Mirrors what `npm run db:init` (scripts/initDb.js) does for local/standalone setup,
// but runs automatically in-process so a freshly provisioned database (e.g. a new Hostinger
// database with nothing in it yet) doesn't need a one-off manual import step.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import mysql from 'mysql2/promise';

export async function ensureTables() {
  const { DB_HOST, DB_USER, DB_PASSWORD, DB_NAME } = process.env;
  const schemaPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'database', 'schema.sql');
  const conn = await mysql.createConnection({
    host: DB_HOST, user: DB_USER, password: DB_PASSWORD, database: DB_NAME,
    multipleStatements: true, connectTimeout: 10_000,
  });
  try {
    await conn.query(readFileSync(schemaPath, 'utf8'));
  } finally {
    await conn.end();
  }
}
