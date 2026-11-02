// Each Ombeni admin can send their own tasks to a Monday.com board of their
// choosing. Choices live in the hub's MySQL database, not a file here, because
// a redeploy resets this folder. Everyone else's tasks go to the shared board
// (see mondayService.getBoardId).
const env = require('../config/env');
const admins = require('./admins');

// Standalone (`node server.js`) there's no hub database, so every task simply
// uses the shared board.
const db = env.IN_HUB ? require('../../../store/db') : null;

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS ombeni_admin_boards (
    email VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL PRIMARY KEY,
    board_id VARCHAR(32) NOT NULL,
    updated_at VARCHAR(32) NOT NULL
  )`;

// Safe to call every boot.
async function init() {
  if (db) await db.query(CREATE_TABLE);
}

// null means "use the shared board": not an admin, or no board chosen. Someone
// removed as an admin goes back to the shared board straight away.
async function boardForAdmin(email) {
  if (!db || !(await admins.isAdmin(email))) return null;
  const rows = await db.query('SELECT board_id FROM ombeni_admin_boards WHERE email = ?', [String(email)]);
  return rows[0] ? rows[0].board_id : null;
}

// An empty boardId clears the choice, going back to the shared board.
async function setBoardForAdmin(email, boardId) {
  if (!db) throw new Error('Personal boards are only available inside the Zawadie Hub');

  const normalized = String(boardId || '').trim();
  if (!normalized) {
    await db.query('DELETE FROM ombeni_admin_boards WHERE email = ?', [String(email)]);
    return null;
  }
  if (!/^\d+$/.test(normalized)) throw new Error('That is not a valid board id');

  const now = new Date().toISOString();
  await db.query(
    'INSERT INTO ombeni_admin_boards (email, board_id, updated_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE board_id = ?, updated_at = ?',
    [String(email), normalized, now, normalized, now]
  );
  return normalized;
}

const words = (text) => String(text || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

// Meeting action items only name their owner as free text ("Kit", "Kit Masi"),
// picked out by AI. Matched against the admins' email names, and only when it
// points to exactly one admin, so a shared first name can't land a task on the
// wrong person's board.
async function adminForOwner(owner) {
  const ownerWords = words(String(owner || '').split('@')[0]);
  if (ownerWords.length === 0) return null;
  const matches = (await admins.list()).filter((email) => {
    const nameWords = words(email.split('@')[0]);
    return ownerWords.every((word) => nameWords.includes(word));
  });
  return matches.length === 1 ? matches[0] : null;
}

async function boardForOwner(owner) {
  const email = await adminForOwner(owner);
  return email ? boardForAdmin(email) : null;
}

module.exports = { init, boardForAdmin, setBoardForAdmin, boardForOwner };
