const fs = require('fs');
const path = require('path');

// Admin-editable text that gets woven into Ombeni AI's system prompt for every
// chat response — behavior, tone, limitations, output format. Persisted to
// disk (not just in-memory) since it's meant to be a durable, deliberate
// configuration, not something that resets on every restart.
const BODY_FILE = path.join(__dirname, 'system-instructions.txt');
const META_FILE = path.join(__dirname, 'system-instructions.meta.json');

function get() {
  const body = fs.existsSync(BODY_FILE) ? fs.readFileSync(BODY_FILE, 'utf-8') : '';
  const meta = fs.existsSync(META_FILE) ? JSON.parse(fs.readFileSync(META_FILE, 'utf-8')) : {};
  return { body, updatedAt: meta.updatedAt || null, updatedBy: meta.updatedBy || null };
}

function set(body, updatedBy) {
  fs.writeFileSync(BODY_FILE, body || '', 'utf-8');
  fs.writeFileSync(META_FILE, JSON.stringify({ updatedAt: new Date().toISOString(), updatedBy }, null, 2), 'utf-8');
  return get();
}

module.exports = { get, set };
