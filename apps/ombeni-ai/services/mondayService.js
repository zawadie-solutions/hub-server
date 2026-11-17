// Monday.com boards and tasks. Everything here acts as ONE person, with their
// own Monday access from "Connect Monday" (see mondayAuth.js): they see only
// the boards they can open, and tasks are created as them, on the board they
// picked. Nothing is ever sent to Monday on its own, and there's no shared board.
//
// The only thing still read with the shared MONDAY_API_KEY is the people
// directory (listPeople), used to match names said in meetings to Zawadie
// emails. Notetaker recordings are read separately (notetakerService.js).
const env = require('../config/env');

const MONDAY_API_URL = 'https://api.monday.com/v2';

// Monday's API has been unreliable in some environments (DNS/connection
// hangs rather than a quick failure): a bounded timeout means a single bad
// request fails fast instead of leaving a caller stuck waiting indefinitely.
const REQUEST_TIMEOUT_MS = 15000;

async function mondayRequest(query, variables, token) {
  if (!token) throw new Error('No Monday access');
  const response = await fetch(MONDAY_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: token },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  const result = await response.json();
  if (result.errors) {
    // Monday repeats an error once per item (e.g. per board): say each once.
    const err = new Error([...new Set(result.errors.map(e => e.message))].join('; '));
    err.mondayErrors = result.errors;
    throw err;
  }
  return result.data;
}

// ---- People directory (shared key) ----

// [{ id, name, email }] for everyone in the Monday account. Refetched hourly
// so a new hire shows up without a restart.
const USERS_TTL_MS = 60 * 60 * 1000;
let usersCache = null;
let usersCachedAt = 0;

async function listPeople() {
  if (!env.MONDAY_API_KEY) return [];
  if (usersCache && Date.now() - usersCachedAt < USERS_TTL_MS) return usersCache;
  const data = await mondayRequest(`query { users (kind: all) { id name email } }`, {}, env.MONDAY_API_KEY);
  usersCache = data.users || [];
  usersCachedAt = Date.now();
  return usersCache;
}

// ---- One person's boards and tasks (their own access) ----

/**
 * The regular boards this person can open in Monday: [{ id, name, workspace }].
 * The workspace name isn't asked for: Monday needs an extra permission
 * (workspaces:read) for it, beyond boards:read.
 */
async function listMyBoards(token) {
  const data = await mondayRequest(`query { boards (limit: 500, state: active) { id name type } }`, {}, token);
  return (data.boards || [])
    .filter(b => b.type === 'board')
    .map(b => ({ id: String(b.id), name: b.name, workspace: null }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Board columns, by board: their ids are random per board (e.g.
// "date_mm77y6zc"), so the date, status, priority and owner columns are found
// by type and title, and only what fits is set. Whatever doesn't fit goes in
// the item name, so nothing is silently lost.
const columnsCache = new Map();

async function getBoardColumns(boardId, token) {
  if (columnsCache.has(boardId)) return columnsCache.get(boardId);
  const data = await mondayRequest(`query ($id: ID!) { boards(ids: [$id]) { columns { id title type settings_str } } }`, { id: boardId }, token);
  const columns = (data.boards && data.boards[0] && data.boards[0].columns) || [];
  columnsCache.set(boardId, columns);
  return columns;
}

function findColumn(columns, { types, titleRegex }) {
  return columns.find(c => types.includes(c.type) && titleRegex.test(c.title));
}

function statusLabels(column) {
  try {
    return Object.values(JSON.parse(column.settings_str).labels || {});
  } catch {
    return [];
  }
}

function toIsoDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

// A board's own label for a value: exact (case-insensitive) first, then by
// meaning, e.g. "High" priority onto a board whose labels are "Top 3 / Later".
function findLabelExactOrSynonym(column, value, synonyms) {
  if (!column || !value) return null;
  const labels = statusLabels(column);
  const normalized = String(value).trim().toLowerCase();
  const exact = labels.find(l => l.trim().toLowerCase() === normalized);
  if (exact) return exact;
  const pattern = synonyms && synonyms[normalized];
  return pattern ? labels.find(l => pattern.test(l)) || null : null;
}

const PRIORITY_SYNONYMS = {
  high: /top.?3|high|urgent|critical|p1/i,
  medium: /later|medium|normal|p2/i,
  low: /secondary|low|minor|p3/i
};

const STATUS_SYNONYMS = { todo: /not started|to.?do|backlog|^open$|^new$/i };

/**
 * Creates a task on one of the person's own boards, as them, assigned to them
 * (ownerUserId: their Monday user id). Returns { created: true, itemId } or
 * { created: false, error }. Never throws.
 */
async function createTask({ token, boardId, task, ownerUserId, due, project, priority, status }) {
  if (!token || !boardId) return { created: false, error: 'Connect Monday and pick a board first.' };
  try {
    const columns = await getBoardColumns(String(boardId), token);
    const columnValues = {};

    const dateColumn = findColumn(columns, { types: ['date', 'timeline'], titleRegex: /due|date/i });
    const isoDate = toIsoDate(due);
    if (dateColumn && isoDate) {
      columnValues[dateColumn.id] = dateColumn.type === 'timeline' ? { from: isoDate, to: isoDate } : { date: isoDate };
    }

    // Only a column literally titled "Status" (some boards also have a
    // separate "Priority" status column, handled below). Default: not started.
    const statusColumn = findColumn(columns, { types: ['status'], titleRegex: /\bstatus\b/i });
    const statusLabel = findLabelExactOrSynonym(statusColumn, status || 'todo', STATUS_SYNONYMS);
    if (statusColumn && statusLabel) columnValues[statusColumn.id] = { label: statusLabel };

    const priorityColumn = findColumn(columns, { types: ['status'], titleRegex: /priority/i });
    const priorityLabel = findLabelExactOrSynonym(priorityColumn, priority, PRIORITY_SYNONYMS);
    if (priorityColumn && priorityLabel) columnValues[priorityColumn.id] = { label: priorityLabel };

    const ownerColumn = findColumn(columns, { types: ['people', 'multiple-person'], titleRegex: /owner|assignee|person/i });
    if (ownerColumn && ownerUserId) columnValues[ownerColumn.id] = { personsAndTeams: [{ id: Number(ownerUserId), kind: 'person' }] };

    const context = [project ? `Project: ${project}` : null, !isoDate && due ? `Due: ${due}` : null].filter(Boolean).join(' · ');
    const itemName = context ? `${task} (${context})` : task;

    // No group given: it goes in the board's first group, where its owner keeps new items.
    const data = await mondayRequest(
      `mutation ($boardId: ID!, $itemName: String!, $columnValues: JSON) {
        create_item (board_id: $boardId, item_name: $itemName, column_values: $columnValues) { id }
      }`,
      { boardId: String(boardId), itemName, columnValues: JSON.stringify(columnValues) },
      token
    );
    return { created: true, itemId: data.create_item.id };
  } catch (err) {
    return { created: false, error: err.message };
  }
}

// Adds a comment ("update") to an item, e.g. the full success statement.
// Monday renders update bodies as HTML, so plain text is escaped and its line
// breaks kept.
async function addUpdate(itemId, text, token) {
  const body = String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
  const data = await mondayRequest(
    `mutation ($itemId: ID!, $body: String!) { create_update (item_id: $itemId, body: $body) { id } }`,
    { itemId: String(itemId), body },
    token
  );
  return data.create_update;
}

module.exports = { listPeople, listMyBoards, createTask, addUpdate };
