// Small JSON-file user store. There's a handful of Zawadie employees, not
// thousands, so a file beats standing up a database for this.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

const SEED_ADMIN_EMAIL = 'kit.masi@zawadie.com';
const SEED_ADMIN_PASSWORD = '@zawadie.com';

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

function load() {
  if (!fs.existsSync(USERS_FILE)) return [];
  return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
}

function save(allUsers) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(USERS_FILE, JSON.stringify(allUsers, null, 2));
}

// Creates the admin account on first run only. Safe to call every boot.
function ensureSeeded(solutionIds) {
  const existing = load();
  if (existing.length > 0) return;
  save([
    {
      email: SEED_ADMIN_EMAIL,
      passwordHash: hashPassword(SEED_ADMIN_PASSWORD),
      role: 'admin',
      solutions: [...solutionIds],
      createdAt: new Date().toISOString(),
    },
  ]);
}

function findByEmail(email) {
  return load().find((u) => u.email.toLowerCase() === String(email).toLowerCase());
}

function all() {
  return load().sort((a, b) => a.email.localeCompare(b.email));
}

function addOrUpdate(user) {
  const allUsers = load();
  const idx = allUsers.findIndex((u) => u.email.toLowerCase() === user.email.toLowerCase());
  if (idx >= 0) allUsers[idx] = { ...allUsers[idx], ...user };
  else allUsers.push(user);
  save(allUsers);
}

function remove(email) {
  save(load().filter((u) => u.email.toLowerCase() !== String(email).toLowerCase()));
}

// Pending accounts (invited but not yet activated) have no passwordHash, so
// verifyPassword always rejects them until they set one via the invite link.
function createInvite({ email, role, solutions }) {
  const allUsers = load();
  allUsers.push({
    email,
    passwordHash: null,
    role,
    solutions,
    inviteToken: crypto.randomBytes(32).toString('hex'),
    inviteTokenExpires: Date.now() + INVITE_TTL_MS,
    createdAt: new Date().toISOString(),
  });
  save(allUsers);
}

function findByInviteToken(token) {
  if (!token) return null;
  return load().find((u) => u.inviteToken === token) || null;
}

function isInviteExpired(user) {
  return !user.inviteTokenExpires || Date.now() > user.inviteTokenExpires;
}

// Issues a new token/expiry for an account that's still pending, e.g.
// because the first link expired before the employee used it.
function resendInvite(email) {
  const allUsers = load();
  const idx = allUsers.findIndex((u) => u.email.toLowerCase() === String(email).toLowerCase() && !u.passwordHash);
  if (idx < 0) return null;
  allUsers[idx].inviteToken = crypto.randomBytes(32).toString('hex');
  allUsers[idx].inviteTokenExpires = Date.now() + INVITE_TTL_MS;
  save(allUsers);
  return allUsers[idx];
}

// Activates a pending account: sets its password and clears the (now used)
// invite token so the link can't be replayed.
function acceptInvite(token, password) {
  const allUsers = load();
  const idx = allUsers.findIndex((u) => u.inviteToken === token && !u.passwordHash);
  if (idx < 0) return null;
  allUsers[idx].passwordHash = hashPassword(password);
  delete allUsers[idx].inviteToken;
  delete allUsers[idx].inviteTokenExpires;
  allUsers[idx].acceptedAt = new Date().toISOString();
  save(allUsers);
  return allUsers[idx];
}

module.exports = {
  hashPassword,
  verifyPassword,
  ensureSeeded,
  findByEmail,
  all,
  addOrUpdate,
  remove,
  createInvite,
  findByInviteToken,
  isInviteExpired,
  resendInvite,
  acceptInvite,
};
