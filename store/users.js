// User store, kept in MySQL so accounts survive a redeploy (which wipes the
// gitignored data/ dir). There's a handful of Zawadie employees, not
// thousands, so every call just reads or writes the table directly.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { query } = require('./db');

// Accounts from before the move to MySQL. Upload one here and restart the hub
// to bring those accounts back; see importLegacyFile.
const LEGACY_USERS_FILE = path.join(__dirname, '..', 'data', 'users.json');

const SEED_ADMIN_EMAIL = 'kit.masi@zawadie.com';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const hashBuffer = Buffer.from(hash, 'hex');
  const candidate = crypto.scryptSync(password, salt, 64);
  if (candidate.length !== hashBuffer.length) return false;
  return crypto.timingSafeEqual(hashBuffer, candidate);
}

// solutions is TEXT rather than JSON because MariaDB treats JSON as text
// anyway, so parsing it here behaves the same on MySQL and MariaDB.
const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS hub_users (
    email VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL PRIMARY KEY,
    password_hash VARCHAR(255) NULL,
    role VARCHAR(20) NOT NULL,
    solutions TEXT NOT NULL,
    invite_token VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    invite_token_expires BIGINT NULL,
    created_at VARCHAR(32) NOT NULL,
    accepted_at VARCHAR(32) NULL,
    UNIQUE KEY hub_users_invite_token (invite_token)
  )`;

const INSERT_COLUMNS = `(email, password_hash, role, solutions, invite_token, invite_token_expires, created_at, accepted_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

function toValues(user) {
  return [
    user.email,
    user.passwordHash ?? null,
    user.role,
    JSON.stringify(user.solutions || []),
    user.inviteToken ?? null,
    user.inviteTokenExpires ?? null,
    user.createdAt ?? new Date().toISOString(),
    user.acceptedAt ?? null,
  ];
}

function fromRow(row) {
  return {
    email: row.email,
    passwordHash: row.password_hash,
    role: row.role,
    solutions: JSON.parse(row.solutions),
    inviteToken: row.invite_token,
    inviteTokenExpires: row.invite_token_expires === null ? null : Number(row.invite_token_expires),
    createdAt: row.created_at,
    acceptedAt: row.accepted_at,
  };
}

// Creates the first admin only when there isn't one. The password comes from
// the HUB_ADMIN_PASSWORD setting and is never written in the code, because
// this repo is public. Changing the setting later doesn't change the password
// of an admin that already exists.
async function ensureAdmin(solutionIds) {
  const admins = await query("SELECT email FROM hub_users WHERE role = 'admin' LIMIT 1");
  if (admins.length > 0) return;

  const password = process.env.HUB_ADMIN_PASSWORD;
  if (!password) {
    console.error('[users] No admin account exists and HUB_ADMIN_PASSWORD is not set, so nobody can administer the hub. Set it and restart.');
    return;
  }
  await query(`INSERT INTO hub_users ${INSERT_COLUMNS}`, toValues({
    email: SEED_ADMIN_EMAIL,
    passwordHash: hashPassword(password),
    role: 'admin',
    solutions: [...solutionIds],
  }));
}

// Copies accounts from an old data/users.json into the table, then renames the
// file so an account removed later isn't brought back by the next restart.
// Existing accounts are left alone, and the seed admin is skipped because old
// files hold the default password that used to be published in this repo.
async function importLegacyFile() {
  if (!fs.existsSync(LEGACY_USERS_FILE)) return;

  const legacyUsers = JSON.parse(fs.readFileSync(LEGACY_USERS_FILE, 'utf8'));
  let imported = 0;
  for (const user of legacyUsers) {
    if (user.email.toLowerCase() === SEED_ADMIN_EMAIL) continue;
    const result = await query(`INSERT IGNORE INTO hub_users ${INSERT_COLUMNS}`, toValues(user));
    imported += result.affectedRows;
  }
  fs.renameSync(LEGACY_USERS_FILE, `${LEGACY_USERS_FILE}.imported`);
  console.log(`[users] Imported ${imported} account(s) from data/users.json.`);
}

// Safe to call every boot.
async function init(solutionIds) {
  await query(CREATE_TABLE);
  await ensureAdmin(solutionIds);
  try {
    await importLegacyFile();
  } catch (err) {
    // A bad file shouldn't stop the hub. It stays in place to be fixed and retried.
    console.error('[users] Could not import data/users.json:', err.message);
  }
}

async function findByEmail(email) {
  const rows = await query('SELECT * FROM hub_users WHERE email = ?', [String(email)]);
  return rows[0] ? fromRow(rows[0]) : undefined;
}

async function all() {
  const rows = await query('SELECT * FROM hub_users ORDER BY email');
  return rows.map(fromRow);
}

async function updateSolutions(email, solutions) {
  await query('UPDATE hub_users SET solutions = ? WHERE email = ?', [JSON.stringify(solutions), String(email)]);
}

async function remove(email) {
  await query('DELETE FROM hub_users WHERE email = ?', [String(email)]);
}

// Pending accounts (invited but not yet activated) have no passwordHash, so
// verifyPassword always rejects them until they set one via the invite link.
async function createInvite({ email, role, solutions }) {
  await query(`INSERT INTO hub_users ${INSERT_COLUMNS}`, toValues({
    email,
    role,
    solutions,
    inviteToken: crypto.randomBytes(32).toString('hex'),
    inviteTokenExpires: Date.now() + INVITE_TTL_MS,
  }));
}

async function findByInviteToken(token) {
  if (!token) return null;
  const rows = await query('SELECT * FROM hub_users WHERE invite_token = ?', [String(token)]);
  return rows[0] ? fromRow(rows[0]) : null;
}

function isInviteExpired(user) {
  return !user.inviteTokenExpires || Date.now() > user.inviteTokenExpires;
}

// Issues a new token/expiry for an account that's still pending, e.g.
// because the first link expired before the employee used it.
async function resendInvite(email) {
  const result = await query(
    'UPDATE hub_users SET invite_token = ?, invite_token_expires = ? WHERE email = ? AND password_hash IS NULL',
    [crypto.randomBytes(32).toString('hex'), Date.now() + INVITE_TTL_MS, String(email)]
  );
  if (result.affectedRows === 0) return null;
  return findByEmail(email);
}

// Activates a pending account: sets its password and clears the (now used)
// invite token so the link can't be replayed.
async function acceptInvite(token, password) {
  const record = await findByInviteToken(token);
  if (!record || record.passwordHash) return null;
  const result = await query(
    'UPDATE hub_users SET password_hash = ?, invite_token = NULL, invite_token_expires = NULL, accepted_at = ? WHERE invite_token = ? AND password_hash IS NULL',
    [hashPassword(password), new Date().toISOString(), String(token)]
  );
  if (result.affectedRows === 0) return null;
  return findByEmail(record.email);
}

module.exports = {
  hashPassword,
  verifyPassword,
  init,
  findByEmail,
  all,
  updateSolutions,
  remove,
  createInvite,
  findByInviteToken,
  isInviteExpired,
  resendInvite,
  acceptInvite,
};
