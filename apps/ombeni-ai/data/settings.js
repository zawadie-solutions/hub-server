const fs = require('fs');
const path = require('path');

// Admin-editable app settings, persisted to disk (unlike config/env.js, which
// only reads .env at startup). Right now the only setting is which Monday.com
// board Ombeni AI creates tasks on — editable from Settings without touching
// the server's environment or restarting it.
const FILE = path.join(__dirname, 'settings.json');

function load() {
  if (!fs.existsSync(FILE)) return {};
  return JSON.parse(fs.readFileSync(FILE, 'utf-8'));
}

function save(data) {
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2), 'utf-8');
}

function get() {
  const data = load();
  return { mondayBoardId: data.mondayBoardId || null };
}

function setMondayBoardId(boardId, updatedBy) {
  const normalized = String(boardId || '').trim();
  if (!normalized) throw new Error('A board id is required');

  const data = load();
  data.mondayBoardId = normalized;
  data.mondayBoardUpdatedAt = new Date().toISOString();
  data.mondayBoardUpdatedBy = updatedBy || null;
  save(data);
  return get();
}

module.exports = { get, setMondayBoardId };
