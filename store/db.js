// Connection pool for the hub's own tables (accounts and sign-ins). They live
// in MySQL rather than data/ because a redeploy re-clones the repo and wipes
// that folder. The pool is created on first use so dotenv has already run.
const mysql = require('mysql2/promise');

let pool;

function getPool() {
  if (!pool) {
    const uri = process.env.HUB_DATABASE_URL || process.env.DATABASE_URL;
    if (!uri) throw new Error('DATABASE_URL is not set, so the hub has nowhere to keep accounts.');
    pool = mysql.createPool({ uri, connectionLimit: 5 });
  }
  return pool;
}

async function query(sql, params = []) {
  const [rows] = await getPool().execute(sql, params);
  return rows;
}

module.exports = { query };
