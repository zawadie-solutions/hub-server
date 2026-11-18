// One record per person who uses Ombeni as a co-worker: their stored Google
// access (encrypted), their on/off choices, and what's already been sent to
// them (so nothing is sent twice). Inside the hub it lives in MySQL, because a
// redeploy deletes files in this folder; standalone it's data/people.json.
//
// A record: { email, google: { enc, scopes, connectedAt, broken }, timeZone,
//             prefs: { morning: bool, prep: bool }, lastMorningDate, prepped: { [eventId]: date } }
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const env = require('../config/env');

const db = env.IN_HUB ? require('../../../store/db') : null;
const FILE = process.env.OMBENI_PEOPLE_FILE || path.join(__dirname, 'people.json');

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS ombeni_people (
    email VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL PRIMARY KEY,
    data MEDIUMTEXT NOT NULL,
    updated_at VARCHAR(32) NOT NULL
  )`;

async function init() {
  if (db) await db.query(CREATE_TABLE);
}

// ---- encryption of the stored Google refresh token (AES-256-GCM) ----

function key() {
  if (!env.TOKEN_KEY) return null;
  return crypto.createHash('sha256').update(`ombeni-google-tokens:${env.TOKEN_KEY}`).digest();
}

function canStoreTokens() {
  return Boolean(key());
}

function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map(b => b.toString('base64')).join('.');
}

// null if the key changed or the value was tampered with: the person simply
// connects Google again.
function decrypt(value) {
  try {
    const [iv, tag, body] = String(value).split('.').map(p => Buffer.from(p, 'base64'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

// ---- storage ----

let fileCache = null;
const fileData = () => (fileCache = fileCache || (fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf-8')) : {}));
const norm = (email) => String(email || '').trim().toLowerCase();

async function get(email) {
  const id = norm(email);
  if (!id) return null;
  if (!db) return fileData()[id] || null;
  const rows = await db.query('SELECT data FROM ombeni_people WHERE email = ?', [id]);
  return rows[0] ? JSON.parse(rows[0].data) : null;
}

async function update(email, patch) {
  const id = norm(email);
  const current = (await get(id)) || { email: id, prefs: {} };
  const next = { ...current, ...patch, email: id };
  if (!db) {
    fileData()[id] = next;
    fs.writeFileSync(FILE, JSON.stringify(fileCache, null, 2), 'utf-8');
    return next;
  }
  const data = JSON.stringify(next);
  const now = new Date().toISOString();
  await db.query(
    'INSERT INTO ombeni_people (email, data, updated_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE data = ?, updated_at = ?',
    [id, data, now, data, now]
  );
  return next;
}

async function list() {
  if (!db) return Object.values(fileData());
  return (await db.query('SELECT data FROM ombeni_people')).map(r => JSON.parse(r.data));
}

// ---- Google access ----

async function saveGoogle(email, { refresh_token, scope }, name) {
  if (!canStoreTokens() || !refresh_token) return null;
  return update(email, {
    ...(name ? { name } : {}),
    google: { enc: encrypt(refresh_token), scopes: String(scope || '').split(' ').filter(Boolean), connectedAt: new Date().toISOString(), broken: false }
  });
}

/** { refresh_token } usable with calendarService, or null. */
function googleTokens(person) {
  if (!person || !person.google || person.google.broken || !canStoreTokens()) return null;
  const refresh = decrypt(person.google.enc);
  return refresh ? { refresh_token: refresh, scope: (person.google.scopes || []).join(' ') } : null;
}

async function markGoogleBroken(email) {
  const person = await get(email);
  if (person && person.google) await update(email, { google: { ...person.google, broken: true } });
}

async function forgetGoogle(email) {
  return update(email, { google: null });
}

// Google said the Gmail permission isn't there after all: Settings offers
// Allow Gmail drafts again, and Ombeni stops offering to save drafts.
async function forgetGmail(email) {
  const person = await get(email);
  if (person && person.google) await update(email, { google: { ...person.google, scopes: (person.google.scopes || []).filter(s => !/gmail/.test(s)) } });
}

module.exports = { init, get, update, list, saveGoogle, googleTokens, markGoogleBroken, forgetGoogle, forgetGmail, canStoreTokens, encrypt, decrypt };
