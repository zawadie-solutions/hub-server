const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const env = require('../config/env');

// Tracks which meeting action items have already been pushed to Monday.com as
// a task, so the periodic Notetaker refresh (store.refreshMeetings, which
// rebuilds the in-memory meeting list from scratch every time) doesn't
// recreate the same task over and over. Inside the hub it lives in MySQL,
// because a redeploy deletes files in this folder, and forgetting what's
// already synced would spam duplicate tasks onto the real boards. Standalone
// (`node server.js`) it's kept in a file.
const db = env.IN_HUB ? require('../../../store/db') : null;

const FILE = path.join(__dirname, 'synced-action-items.json');

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS ombeni_synced_action_items (
    key_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    item_key TEXT NOT NULL,
    synced_at VARCHAR(32) NOT NULL
  )`;

// Keys include free text of any length, so the primary key is their hash.
const hash = (key) => crypto.createHash('sha256').update(key).digest('hex');

// Marks that the table has taken its first look at the existing meetings.
const BASELINE_KEY = '__baseline_recorded__';

async function init() {
  if (db) await db.query(CREATE_TABLE);
}

function load() {
  if (!fs.existsSync(FILE)) return [];
  return JSON.parse(fs.readFileSync(FILE, 'utf-8'));
}

let cache = null;

function keys() {
  if (!cache) cache = new Set(load());
  return cache;
}

async function has(key) {
  if (!db) return keys().has(key);
  const rows = await db.query('SELECT 1 FROM ombeni_synced_action_items WHERE key_hash = ?', [hash(key)]);
  return rows.length > 0;
}

async function markSynced(key) {
  if (!db) {
    keys().add(key);
    fs.writeFileSync(FILE, JSON.stringify([...keys()], null, 2), 'utf-8');
    return;
  }
  await db.query(
    'INSERT IGNORE INTO ombeni_synced_action_items (key_hash, item_key, synced_at) VALUES (?, ?, ?)',
    [hash(key), key, new Date().toISOString()]
  );
}

// True the first time this runs on the database. The old record was a file that
// redeploys deleted, so there's no telling what already reached Monday; pushing
// every existing action item would flood the boards with repeats.
async function needsBaseline() {
  return Boolean(db) && !(await has(BASELINE_KEY));
}

// Records existing action items as already handled, without creating tasks.
// The marker goes last, so an interrupted run simply starts again.
async function recordBaseline(existingKeys) {
  for (const key of existingKeys) await markSynced(key);
  await markSynced(BASELINE_KEY);
}

module.exports = { init, has, markSynced, needsBaseline, recordBaseline };
