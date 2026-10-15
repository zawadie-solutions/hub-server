import { readFileSync } from "node:fs";
import mysql from "mysql2/promise";
import { config } from "../config";

/** Minimal surface used by the repo. Statements use numbered placeholders ($1, $2, ...). */
export interface Db {
  query<T = any>(text: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>;
  end(): Promise<void>;
}

/**
 * The repo writes `$1, $2, ...` so a value can be named once and used in any order;
 * MySQL takes `?` in order of appearance. Rewrites one into the other.
 */
export function positional(text: string, params: unknown[] = []): { sql: string; values: unknown[] } {
  const values: unknown[] = [];
  const sql = text.replace(/\$(\d+)/g, (_m, n: string) => {
    const i = Number(n) - 1;
    if (i < 0 || i >= params.length) throw new Error(`statement uses $${n} but only ${params.length} value(s) were given`);
    values.push(params[i]);
    return "?";
  });
  return { sql, values };
}

/** Parses mysql://user:password@host:port/database into what the driver needs. */
export function parseMysqlUrl(url: string): { host: string; port: number; user: string; password: string; database: string } {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error("DATABASE_URL is not a valid URL; expected mysql://user:password@host:3306/database");
  }
  if (u.protocol !== "mysql:") {
    throw new Error(`DATABASE_URL must start with mysql:// (found ${u.protocol}//); expected mysql://user:password@host:3306/database`);
  }
  const database = decodeURIComponent(u.pathname.replace(/^\//, ""));
  if (!database) throw new Error("DATABASE_URL has no database name; expected mysql://user:password@host:3306/database");
  return { host: u.hostname, port: u.port ? Number(u.port) : 3306, user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), database };
}

export function createDb(url: string = config.databaseUrl()): Db {
  const pool = mysql.createPool({
    ...parseMysqlUrl(url),
    connectionLimit: 10,
    // Times are stored and read as UTC, whatever the server's own time zone is.
    timezone: "Z",
    // MySQL has no boolean type: TINYINT(1) columns are the app's booleans.
    typeCast: (field, next) => {
      if (field.type === "TINY" && field.length === 1) {
        const v = field.string();
        return v === null ? null : v === "1";
      }
      return next();
    },
    // Count a row an UPDATE matched even when the new values equal the old ones, as the repo expects.
    flags: ["FOUND_ROWS"],
  });
  // NOW() in SQL must agree with the UTC the app writes.
  pool.pool.on("connection", (conn) => conn.query("SET time_zone = '+00:00'"));

  return {
    async query<T = any>(text: string, params?: unknown[]) {
      const { sql, values } = positional(text, params);
      const [result] = await pool.query(sql, values);
      if (Array.isArray(result)) return { rows: result as T[], rowCount: result.length };
      return { rows: [], rowCount: (result as mysql.ResultSetHeader).affectedRows ?? null };
    },
    end: () => pool.end(),
  };
}

export async function migrate(db: Db): Promise<void> {
  const sql = readFileSync(new URL("./schema.sql", import.meta.url), "utf8");
  // Comments are dropped first so a semicolon inside one cannot split a statement.
  const statements = sql
    .replace(/^\s*--.*$/gm, "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const stmt of statements) await db.query(stmt);
  for (const [table, column, type] of ADDED_COLUMNS) await ensureColumn(db, table, column, type);
}

/** Columns added after a table first shipped. CREATE TABLE IF NOT EXISTS leaves an existing table as it is, so these are added here. */
const ADDED_COLUMNS: [table: string, column: string, type: string][] = [
  ["reviews", "assignee_name", "VARCHAR(255)"],
  ["reviews", "location_assignee_name", "VARCHAR(255)"],
];

async function ensureColumn(db: Db, table: string, column: string, type: string): Promise<void> {
  const r = await db.query("SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = $1 AND column_name = $2", [table, column]);
  if (!r.rows.length) await db.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${type}`);
}
