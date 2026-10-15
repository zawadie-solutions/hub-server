import mysql from "mysql2/promise";
import { createDb, type Db } from "./db";

/**
 * A brand-new, empty database on a MySQL server, with a name nothing else uses. For the test
 * suite and the fake-data preview, which must never touch the real database. `serverUrl` is a
 * mysql:// URL; any database name in it is ignored. The account needs CREATE and DROP rights.
 */
export async function createScratchDb(serverUrl: string, prefix: string): Promise<{ db: Db; name: string; drop: () => Promise<void> }> {
  const url = new URL(serverUrl);
  if (url.protocol !== "mysql:") throw new Error(`expected a mysql:// URL for the scratch database server, found ${url.protocol}//`);
  const server = { host: url.hostname, port: url.port ? Number(url.port) : 3306, user: decodeURIComponent(url.username), password: decodeURIComponent(url.password) };
  const name = `${prefix}_${process.pid}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

  const admin = await mysql.createConnection(server);
  await admin.query(`CREATE DATABASE \`${name}\``);
  await admin.end();

  url.pathname = `/${name}`;
  const db = createDb(url.href);
  return {
    db,
    name,
    async drop() {
      await db.end().catch(() => {});
      const a = await mysql.createConnection(server);
      await a.query(`DROP DATABASE IF EXISTS \`${name}\``);
      await a.end();
    },
  };
}
