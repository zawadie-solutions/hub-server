// Persists a random session secret to disk so restarting the hub doesn't
// log everyone out (a secret regenerated every boot would invalidate every
// existing session cookie).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const SECRET_FILE = path.join(DATA_DIR, 'session-secret.txt');

function getSessionSecret() {
  // In production, set SESSION_SECRET in hPanel so a redeploy (which re-clones
  // the repo and wipes the gitignored data/ dir) doesn't invalidate every
  // signed-in session. Falls back to a generated, disk-persisted one for dev.
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (fs.existsSync(SECRET_FILE)) return fs.readFileSync(SECRET_FILE, 'utf8').trim();
  const secret = crypto.randomBytes(48).toString('hex');
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SECRET_FILE, secret);
  return secret;
}

module.exports = { getSessionSecret };
