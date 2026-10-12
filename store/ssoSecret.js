// Persists a random secret to disk, shared with every proxied solution so
// they can verify the identity header the hub attaches to each proxied
// request instead of each running their own login screen. Each solution
// needs this same value in its own .env as ZAWADIE_SSO_SECRET.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const SECRET_FILE = path.join(DATA_DIR, 'sso-secret.txt');

function getSsoSecret() {
  // In production, set ZAWADIE_SSO_SECRET in hPanel (same value on the hub
  // and every proxied app) so a redeploy that wipes the gitignored data/ dir
  // doesn't regenerate this and desync it from the other apps. Falls back to
  // a generated, disk-persisted one for dev.
  if (process.env.ZAWADIE_SSO_SECRET) return process.env.ZAWADIE_SSO_SECRET;
  if (fs.existsSync(SECRET_FILE)) return fs.readFileSync(SECRET_FILE, 'utf8').trim();
  const secret = crypto.randomBytes(48).toString('hex');
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SECRET_FILE, secret);
  return secret;
}

module.exports = { getSsoSecret };
