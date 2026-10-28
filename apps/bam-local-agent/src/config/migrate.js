import pool from './db.js';

const CHUNK_TYPES = ['playbook', 'demographic', 'school', 'event', 'community', 'culture'];

async function hasColumn(table, column) {
  const [rows] = await pool.execute(
    'SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1',
    [table, column]
  );
  return rows.length > 0;
}

/**
 * Brings an existing database up to date (a fresh install gets all of this from database/schema.sql):
 *  - knowledge_chunks.chunk_type also accepts 'community' and 'culture' (auto-researched local knowledge)
 *  - stores.research_status / research_error / research_queued_at / researched_at track the automatic local research
 * Safe to run on every start. Failures are logged, not fatal; database/migrations/002_auto_research.sql does the same by hand.
 */
export async function ensureSchema() {
  try {
    const [[col]] = await pool.execute(
      "SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'knowledge_chunks' AND COLUMN_NAME = 'chunk_type'"
    );
    if (col && !col.COLUMN_TYPE.includes("'culture'")) {
      await pool.query(`ALTER TABLE knowledge_chunks MODIFY chunk_type ENUM(${CHUNK_TYPES.map((t) => `'${t}'`).join(',')}) NOT NULL`);
      console.log('[migrate] knowledge_chunks.chunk_type now accepts community and culture');
    }
    if (!(await hasColumn('stores', 'research_status'))) {
      await pool.query("ALTER TABLE stores ADD COLUMN research_status VARCHAR(12) NOT NULL DEFAULT 'none'");
      console.log('[migrate] added stores.research_status');
    }
    if (!(await hasColumn('stores', 'research_error'))) {
      await pool.query('ALTER TABLE stores ADD COLUMN research_error VARCHAR(255) NULL');
      console.log('[migrate] added stores.research_error');
    }
    if (!(await hasColumn('stores', 'research_queued_at'))) {
      await pool.query('ALTER TABLE stores ADD COLUMN research_queued_at TIMESTAMP NULL DEFAULT NULL');
      console.log('[migrate] added stores.research_queued_at');
    }
    if (!(await hasColumn('stores', 'researched_at'))) {
      await pool.query('ALTER TABLE stores ADD COLUMN researched_at TIMESTAMP NULL DEFAULT NULL');
      console.log('[migrate] added stores.researched_at');
    }
  } catch (err) {
    console.error(`[migrate] Could not update the database automatically: ${err.message}. Run database/migrations/002_auto_research.sql by hand.`);
  }
}
