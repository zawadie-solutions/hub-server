const fs = require('fs');
const path = require('path');

// The shared Monday.com board: where tasks go unless an admin has chosen their
// own (see data/adminBoards.js). When set here it wins over MONDAY_BOARD_ID.
const FILE = path.join(__dirname, 'settings.json');

function load() {
  if (!fs.existsSync(FILE)) return {};
  return JSON.parse(fs.readFileSync(FILE, 'utf-8'));
}

function get() {
  const data = load();
  return { mondayBoardId: data.mondayBoardId || null };
}

module.exports = { get };
