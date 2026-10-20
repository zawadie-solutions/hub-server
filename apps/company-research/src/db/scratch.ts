import mysql from "mysql2/promise";
import { createDb, type Db } from "./db";

/**
 * A brand-new, empty database on a MySQL server, with a name nothing else uses — for the tests,
 * which must never touch the real data. The account needs CREATE and DROP rights.
 */
export async function createScratchDb(serverUrl: string, prefix: string): Promise<{ db: Db; drop: () => Promise<void> }> {
  const url = new URL(serverUrl);
  const server = { host: url.hostname, port: url.port ? Number(url.port) : 3306, user: decodeURIComponent(url.username), password: decodeURIComponent(url.password) };
  const name = `${prefix}_${process.pid}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const admin = await mysql.createConnection(server);
  await admin.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4`);
  await admin.end();
  url.pathname = `/${name}`;
  const db = createDb(url.toString());
  return {
    db,
    async drop() {
      await db.end();
      const conn = await mysql.createConnection(server);
      await conn.query(`DROP DATABASE IF EXISTS \`${name}\``);
      await conn.end();
    },
  };
}
