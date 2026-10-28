// Creates the database named in DB_NAME (if missing) and applies database/schema.sql.
// Usage: npm run db:init
import 'dotenv/config';
import fs from 'fs';
import mysql from 'mysql2/promise';

const { DB_HOST, DB_USER, DB_PASSWORD, DB_NAME } = process.env;
if (!DB_NAME || !DB_USER) { console.error('Set DB_HOST, DB_USER, DB_PASSWORD and DB_NAME in .env first.'); process.exit(1); }

let conn;
try {
  conn = await mysql.createConnection({
    host: DB_HOST, user: DB_USER, password: DB_PASSWORD, multipleStatements: true, connectTimeout: 10_000
  });
  const db = conn.escapeId(DB_NAME);
  await conn.query(`CREATE DATABASE IF NOT EXISTS ${db} CHARACTER SET utf8mb4`);
  await conn.query(`USE ${db}`);
  await conn.query(fs.readFileSync(new URL('../database/schema.sql', import.meta.url), 'utf8'));
  const [tables] = await conn.query('SHOW TABLES');
  const [stores] = await conn.query('SELECT location_id FROM stores');
  console.log(`Database "${DB_NAME}" ready. Tables: ${tables.map((t) => Object.values(t)[0]).join(', ')}`);
  console.log(`Stores: ${stores.map((s) => s.location_id).join(', ')}`);
} catch (err) {
  console.error(`Database setup failed: ${err.code || ''} ${err.message}`);
  if (err.code === 'ECONNREFUSED') console.error('MySQL is not running on ' + DB_HOST + '. Start it (XAMPP/WAMP/MySQL service) and retry.');
  process.exitCode = 1;
} finally {
  await conn?.end();
}
