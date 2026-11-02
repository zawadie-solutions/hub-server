const fs = require('fs');
const path = require('path');
const env = require('../config/env');

// Dynamic admin list, editable from Settings (unlike a hardcoded array in
// code). Inside the hub it lives in MySQL, because a redeploy puts this
// folder's files back to their GitHub versions; admins.json only seeds the
// table the first time. Standalone (`node server.js`) the file is the list.
const db = env.IN_HUB ? require('../../../store/db') : null;

const FILE = path.join(__dirname, 'admins.json');
const SEED = ['richesse.kabamba@zawadie.com', 'tyler.clark@zawadie.com', 'kit.masi@zawadie.com'];

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS ombeni_admins (
    email VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL PRIMARY KEY,
    added_at VARCHAR(32) NOT NULL
  )`;

function loadFile() {
  if (!fs.existsSync(FILE)) {
    saveFile(SEED);
    return SEED.slice();
  }
  return JSON.parse(fs.readFileSync(FILE, 'utf-8'));
}

function saveFile(list) {
  fs.writeFileSync(FILE, JSON.stringify(list, null, 2), 'utf-8');
}

const INSERT = 'INSERT IGNORE INTO ombeni_admins (email, added_at) VALUES (?, ?)';

// Safe to call every boot: a removed admin isn't brought back, because the
// table is only seeded while it's empty.
async function init() {
  if (!db) return;
  await db.query(CREATE_TABLE);
  const existing = await db.query('SELECT email FROM ombeni_admins LIMIT 1');
  if (existing.length > 0) return;
  const now = new Date().toISOString();
  for (const email of loadFile()) await db.query(INSERT, [String(email).toLowerCase(), now]);
}

async function list() {
  if (!db) return loadFile();
  const rows = await db.query('SELECT email FROM ombeni_admins ORDER BY added_at, email');
  return rows.map(row => row.email);
}

async function isAdmin(email) {
  if (!email) return false;
  return (await list()).includes(String(email).toLowerCase());
}

async function add(email) {
  const normalized = String(email || '').toLowerCase().trim();
  if (!normalized || !normalized.includes('@')) throw new Error('Enter a valid email address');
  const admins = await list();
  if (admins.includes(normalized)) throw new Error('Already an admin');
  if (db) {
    await db.query(INSERT, [normalized, new Date().toISOString()]);
    return list();
  }
  admins.push(normalized);
  saveFile(admins);
  return admins;
}

async function remove(email) {
  const normalized = String(email || '').toLowerCase().trim();
  const admins = await list();
  if (admins.length <= 1) throw new Error('Cannot remove the last remaining admin');
  if (!admins.includes(normalized)) throw new Error('That email is not an admin');
  if (db) {
    await db.query('DELETE FROM ombeni_admins WHERE email = ?', [normalized]);
    return list();
  }
  const next = admins.filter(a => a !== normalized);
  saveFile(next);
  return next;
}

module.exports = { init, list, isAdmin, add, remove };
