const fs = require('fs');
const path = require('path');

// Dynamic admin list, persisted to disk so it survives restarts and is
// editable from Settings (unlike a hardcoded array in code). Seeded once
// from the original three admins the first time this file doesn't exist yet.
const FILE = path.join(__dirname, 'admins.json');
const SEED = ['richesse.kabamba@zawadie.com', 'tyler.clark@zawadie.com', 'kit.masi@zawadie.com'];

function load() {
  if (!fs.existsSync(FILE)) {
    save(SEED);
    return SEED.slice();
  }
  return JSON.parse(fs.readFileSync(FILE, 'utf-8'));
}

function save(list) {
  fs.writeFileSync(FILE, JSON.stringify(list, null, 2), 'utf-8');
}

function list() {
  return load();
}

function isAdmin(email) {
  if (!email) return false;
  return load().includes(String(email).toLowerCase());
}

function add(email) {
  const normalized = String(email || '').toLowerCase().trim();
  if (!normalized || !normalized.includes('@')) throw new Error('Enter a valid email address');
  const admins = load();
  if (admins.includes(normalized)) throw new Error('Already an admin');
  admins.push(normalized);
  save(admins);
  return admins;
}

function remove(email) {
  const normalized = String(email || '').toLowerCase().trim();
  const admins = load();
  if (admins.length <= 1) throw new Error('Cannot remove the last remaining admin');
  if (!admins.includes(normalized)) throw new Error('That email is not an admin');
  const next = admins.filter(a => a !== normalized);
  save(next);
  return next;
}

module.exports = { list, isAdmin, add, remove };
