// Meeting briefs and the success statements written from them ("assignments").
// Inside the hub they live in MySQL, because a redeploy deletes files in this
// folder and people would lose their work. Standalone (`node server.js`) they're
// kept in data/work-store.json.
//
// A brief:      { meetingId, status: 'done'|'failed', attempts, kind, externalDomains,
//                 waitingOnClient: [...], error, createdAt }
// An assignment: { id, meetingId, meetingTitle, meetingDate, ownerEmail (null = unassigned),
//                  ownerName, assignedBy, title, statement, status: 'new'|'confirmed'|'done',
//                  declinedBy: [emails], slack, monday, createdAt, updatedAt }
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const env = require('../config/env');

const db = env.IN_HUB ? require('../../../store/db') : null;
const FILE = process.env.OMBENI_WORK_STORE_FILE || path.join(__dirname, 'work-store.json');

const TABLES = [
  `CREATE TABLE IF NOT EXISTS ombeni_briefs (
    meeting_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    data MEDIUMTEXT NOT NULL,
    updated_at VARCHAR(32) NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS ombeni_assignments (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    meeting_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    owner_email VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NULL,
    data MEDIUMTEXT NOT NULL,
    updated_at VARCHAR(32) NOT NULL,
    INDEX idx_owner (owner_email),
    INDEX idx_meeting (meeting_id)
  )`,
  `CREATE TABLE IF NOT EXISTS ombeni_work_settings (
    name VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    value TEXT NOT NULL
  )`
];

async function init() {
  if (db) for (const sql of TABLES) await db.query(sql);
}

// ---- standalone file backend ----

let fileCache = null;

function fileData() {
  if (!fileCache) {
    fileCache = fs.existsSync(FILE)
      ? JSON.parse(fs.readFileSync(FILE, 'utf-8'))
      : { briefs: {}, assignments: {}, settings: {} };
  }
  return fileCache;
}

function saveFile() {
  fs.writeFileSync(FILE, JSON.stringify(fileCache, null, 2), 'utf-8');
}

// ---- shared helpers ----

const now = () => new Date().toISOString();
const parseRows = (rows) => rows.map(r => JSON.parse(r.data));

async function getSetting(name) {
  if (!db) return fileData().settings[name] ?? null;
  const rows = await db.query('SELECT value FROM ombeni_work_settings WHERE name = ?', [name]);
  return rows[0] ? rows[0].value : null;
}

async function setSetting(name, value) {
  if (!db) { fileData().settings[name] = value; saveFile(); return; }
  await db.query(
    'INSERT INTO ombeni_work_settings (name, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = ?',
    [name, value, value]
  );
}

async function getBrief(meetingId) {
  if (!db) return fileData().briefs[meetingId] || null;
  const rows = await db.query('SELECT data FROM ombeni_briefs WHERE meeting_id = ?', [meetingId]);
  return rows[0] ? JSON.parse(rows[0].data) : null;
}

async function getBriefs(meetingIds) {
  if (!meetingIds.length) return [];
  if (!db) return meetingIds.map(id => fileData().briefs[id]).filter(Boolean);
  const rows = await db.query(
    `SELECT data FROM ombeni_briefs WHERE meeting_id IN (${meetingIds.map(() => '?').join(',')})`,
    meetingIds
  );
  return parseRows(rows);
}

async function saveBrief(brief) {
  const record = { ...brief, updatedAt: now() };
  if (!db) { fileData().briefs[brief.meetingId] = record; saveFile(); return record; }
  const data = JSON.stringify(record);
  await db.query(
    'INSERT INTO ombeni_briefs (meeting_id, data, updated_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE data = ?, updated_at = ?',
    [brief.meetingId, data, record.updatedAt, data, record.updatedAt]
  );
  return record;
}

async function getAssignment(id) {
  if (!db) return fileData().assignments[id] || null;
  const rows = await db.query('SELECT data FROM ombeni_assignments WHERE id = ?', [String(id)]);
  return rows[0] ? JSON.parse(rows[0].data) : null;
}

async function saveAssignment(assignment) {
  const record = {
    ...assignment,
    id: assignment.id || crypto.randomUUID(),
    ownerEmail: assignment.ownerEmail ? assignment.ownerEmail.toLowerCase() : null,
    createdAt: assignment.createdAt || now(),
    updatedAt: now()
  };
  if (!db) { fileData().assignments[record.id] = record; saveFile(); return record; }
  const data = JSON.stringify(record);
  await db.query(
    `INSERT INTO ombeni_assignments (id, meeting_id, owner_email, data, updated_at) VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE owner_email = ?, data = ?, updated_at = ?`,
    [record.id, record.meetingId, record.ownerEmail, data, record.updatedAt, record.ownerEmail, data, record.updatedAt]
  );
  return record;
}

async function deleteAssignment(id) {
  if (!db) { delete fileData().assignments[id]; saveFile(); return; }
  await db.query('DELETE FROM ombeni_assignments WHERE id = ?', [String(id)]);
}

async function assignmentsForOwner(email) {
  const owner = String(email || '').toLowerCase();
  if (!owner) return [];
  if (!db) return Object.values(fileData().assignments).filter(a => a.ownerEmail === owner);
  return parseRows(await db.query('SELECT data FROM ombeni_assignments WHERE owner_email = ?', [owner]));
}

async function unassignedForMeetings(meetingIds) {
  if (!meetingIds.length) return [];
  if (!db) {
    const ids = new Set(meetingIds);
    return Object.values(fileData().assignments).filter(a => !a.ownerEmail && ids.has(a.meetingId));
  }
  const rows = await db.query(
    `SELECT data FROM ombeni_assignments WHERE owner_email IS NULL AND meeting_id IN (${meetingIds.map(() => '?').join(',')})`,
    meetingIds
  );
  return parseRows(rows);
}

module.exports = {
  init,
  getSetting,
  setSetting,
  getBrief,
  getBriefs,
  saveBrief,
  getAssignment,
  saveAssignment,
  deleteAssignment,
  assignmentsForOwner,
  unassignedForMeetings
};
