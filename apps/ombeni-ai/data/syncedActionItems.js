const fs = require('fs');
const path = require('path');

// Tracks which meeting action items have already been pushed to Monday.com as
// a task, so the periodic Notetaker refresh (store.refreshMeetings, which
// rebuilds the in-memory meeting list from scratch every time) doesn't
// recreate the same task over and over. Persisted to disk — not just kept in
// memory like the rest of store.js — specifically so a server restart doesn't
// forget what's already synced and spam duplicate tasks onto the real board.
const FILE = path.join(__dirname, 'synced-action-items.json');

function load() {
  if (!fs.existsSync(FILE)) return [];
  return JSON.parse(fs.readFileSync(FILE, 'utf-8'));
}

let cache = null;

function keys() {
  if (!cache) cache = new Set(load());
  return cache;
}

function has(key) {
  return keys().has(key);
}

function markSynced(key) {
  keys().add(key);
  fs.writeFileSync(FILE, JSON.stringify([...keys()], null, 2), 'utf-8');
}

module.exports = { has, markSynced };
