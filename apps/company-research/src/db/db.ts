import { readFileSync } from "node:fs";
import mysql from "mysql2/promise";

/** The small surface the app needs. Statements use `?` placeholders. */
export interface Db {
  query<T = Record<string, any>>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<{ insertId: number; affectedRows: number }>;
  /** Runs `fn` on one connection inside a transaction; rolled back if it throws. */
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
  end(): Promise<void>;
}

/** Parses mysql://user:password@host:port/database into what the driver needs. */
export function parseMysqlUrl(url: string) {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error("The Company Research database URL is not valid; expected mysql://user:password@host:3306/database");
  }
  if (u.protocol !== "mysql:") throw new Error(`The Company Research database URL must start with mysql:// (found ${u.protocol}//)`);
  const database = decodeURIComponent(u.pathname.replace(/^\//, ""));
  if (!database) throw new Error("The Company Research database URL has no database name");
  return { host: u.hostname, port: u.port ? Number(u.port) : 3306, user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), database };
}

type Runner = Pick<mysql.Pool, "query">;

function wrap(runner: Runner, transaction: Db["transaction"], end: Db["end"]): Db {
  return {
    async query<T>(sql: string, params?: unknown[]) {
      const [rows] = await runner.query(sql, params);
      return rows as T[];
    },
    async execute(sql: string, params?: unknown[]) {
      const [result] = await runner.query(sql, params);
      const header = result as mysql.ResultSetHeader;
      return { insertId: header.insertId, affectedRows: header.affectedRows };
    },
    transaction,
    end,
  };
}

export function createDb(url: string): Db {
  const pool = mysql.createPool({
    ...parseMysqlUrl(url),
    connectionLimit: 10,
    charset: "utf8mb4",
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
    // Count a row an UPDATE matched even when the new values equal the old ones.
    flags: ["FOUND_ROWS"],
  });
  pool.pool.on("connection", (conn) => conn.query("SET time_zone = '+00:00'"));

  const transaction: Db["transaction"] = async (fn) => {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const tx = wrap(conn, (inner) => inner(tx), async () => undefined);
      const out = await fn(tx);
      await conn.commit();
      return out;
    } catch (e) {
      await conn.rollback().catch(() => undefined);
      throw e;
    } finally {
      conn.release();
    }
  };
  return wrap(pool, transaction, () => pool.end());
}

export async function migrate(db: Db): Promise<void> {
  const sql = readFileSync(new URL("./schema.sql", import.meta.url), "utf8");
  // Comments are dropped first so a semicolon inside one cannot split a statement.
  const statements = sql
    .replace(/^\s*--.*$/gm, "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const stmt of statements) await db.execute(stmt);
}

/** JSON columns are written as text; mysql2 hands them back already parsed. */
export const json = (value: unknown) => (value === null || value === undefined ? null : JSON.stringify(value));

/** Mirrors the column widths in schema.sql so an over-long value is cut, not rejected. */
export const clip = (value: string | null | undefined, max: number) => (value == null ? null : value.length > max ? value.slice(0, max) : value);
