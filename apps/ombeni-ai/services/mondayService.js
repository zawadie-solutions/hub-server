const env = require('../config/env');
const settings = require('../data/settings');

const MONDAY_API_URL = 'https://api.monday.com/v2';

// The board tasks get created on is normally fixed by MONDAY_BOARD_ID in
// .env, but an admin can override it from Settings (see data/settings.js) —
// that override always wins, without needing a server restart.
function getBoardId() {
  return settings.get().mondayBoardId || env.MONDAY_BOARD_ID;
}

function isConfigured() {
  return Boolean(env.MONDAY_API_KEY) && Boolean(getBoardId());
}

// Monday's API has been unreliable in some environments (DNS/connection
// hangs rather than a quick failure) — a bounded timeout means a single bad
// request fails fast instead of leaving a caller (e.g. the analyze endpoint,
// or chat's create_monday_task tool call) stuck waiting indefinitely.
const REQUEST_TIMEOUT_MS = 15000;

async function mondayRequest(query, variables) {
  const response = await fetch(MONDAY_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: env.MONDAY_API_KEY },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  const result = await response.json();
  if (result.errors) {
    const err = new Error(result.errors.map(e => e.message).join('; '));
    err.mondayErrors = result.errors;
    throw err;
  }
  return result.data;
}

// Every real Zawadie board we've inspected (Leadership Huddle, Department Huddle,
// Methods, Zawadie AI Transformation & Training Center) uses a "people" column for
// the owner/assignee and either a "date" or "timeline" column for due dates — none
// have a plain text Owner/Project field, and a people column needs a real Monday
// user id, not a free-text name. So rather than assume fixed column ids (which are
// random per-board anyway, e.g. "date_mm77y6zc"), we look the target board's
// columns up by type/title and only set what actually fits; owner/project always
// go into the item name too, so nothing is silently lost if no matching column exists.
let columnsCache = null;
let columnsCacheBoardId = null;

async function getBoardColumns(boardId) {
  if (columnsCache && columnsCacheBoardId === boardId) return columnsCache;
  const data = await mondayRequest(
    `query ($id: ID!) { boards(ids: [$id]) { columns { id title type settings_str } } }`,
    { id: boardId }
  );
  const board = data.boards && data.boards[0];
  columnsCache = board ? board.columns : [];
  columnsCacheBoardId = boardId;
  return columnsCache;
}

// Every task Ombeni AI creates goes into this group, regardless of which
// board is configured — created automatically on a board the first time a
// task needs to land there if it doesn't already exist (e.g. after an admin
// switches to a new board in Settings).
const TASK_GROUP_NAME = 'AI Ombeni Board';

let groupCache = null;
let groupCacheBoardId = null;

async function getOrCreateTaskGroup(boardId) {
  if (groupCache && groupCacheBoardId === boardId) return groupCache;

  const data = await mondayRequest(
    `query ($id: ID!) { boards(ids: [$id]) { groups { id title } } }`,
    { id: boardId }
  );
  const groups = (data.boards && data.boards[0] && data.boards[0].groups) || [];
  const normalized = TASK_GROUP_NAME.trim().toLowerCase();
  let group = groups.find(g => (g.title || '').trim().toLowerCase() === normalized);

  if (!group) {
    const created = await mondayRequest(
      `mutation ($boardId: ID!, $groupName: String!) {
        create_group (board_id: $boardId, group_name: $groupName) { id }
      }`,
      { boardId, groupName: TASK_GROUP_NAME }
    );
    group = created.create_group;
  }

  groupCache = group.id;
  groupCacheBoardId = boardId;
  return groupCache;
}

// Workspace user directory, for resolving an action item's free-text owner
// name (e.g. "David Mensah") to a real Monday user id — needed because the
// people column rejects plain text. Cached for the same reason columns are:
// this is called once per task creation, and the directory doesn't change
// within a server's lifetime often enough to justify a fresh fetch every time.
let usersCache = null;

async function getUsers() {
  if (usersCache) return usersCache;
  const data = await mondayRequest(`query { users (kind: all) { id name email } }`, {});
  usersCache = data.users || [];
  return usersCache;
}

function findUserByName(users, name) {
  if (!name) return null;
  const normalized = String(name).trim().toLowerCase();
  if (!normalized) return null;
  return users.find(u => (u.name || '').trim().toLowerCase() === normalized) || null;
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
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

// Resolves a value to one of a status/priority column's real labels: an exact
// (case-insensitive) match wins first — e.g. the manual task form's dropdowns
// send the board's own label text ("Top 3", "In Progress") directly — and
// falls back to a synonym match for values on a different scale, like the
// High/Medium/Low priority AI meeting analysis produces.
function findLabelExactOrSynonym(column, value, synonyms) {
  if (!column || !value) return null;
  const labels = statusLabels(column);
  const normalized = String(value).trim().toLowerCase();
  const exact = labels.find(l => l.trim().toLowerCase() === normalized);
  if (exact) return exact;
  const pattern = synonyms && synonyms[normalized];
  if (!pattern) return null;
  return labels.find(l => pattern.test(l)) || null;
}

const PRIORITY_SYNONYMS = {
  high: /top.?3|high|urgent|critical|p1/i,
  medium: /later|medium|normal|p2/i,
  low: /secondary|low|minor|p3/i
};

const STATUS_SYNONYMS = {
  todo: /not started|to.?do|backlog|^open$|^new$/i
};

// Uploads a file to an item's file-type column. Uses Monday's separate
// /v2/file multipart endpoint (not the normal JSON GraphQL endpoint) — each
// variable, including the file itself, goes in as its own `variables[name]`
// form field rather than a JSON body.
async function attachFileToItem(itemId, columnId, file) {
  const form = new FormData();
  form.append('query', `mutation ($itemId: ID!, $columnId: String!, $file: File!) {
    add_file_to_column (item_id: $itemId, column_id: $columnId, file: $file) { id }
  }`);
  form.append('variables[itemId]', String(itemId));
  form.append('variables[columnId]', columnId);
  form.append('variables[file]', new Blob([file.buffer], { type: file.mimetype || 'application/octet-stream' }), file.filename);

  const response = await fetch('https://api.monday.com/v2/file', {
    method: 'POST',
    headers: { Authorization: env.MONDAY_API_KEY },
    body: form,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  const result = await response.json();
  if (result.errors) {
    throw new Error(result.errors.map(e => e.message).join('; '));
  }
  return result.data;
}

/**
 * Creates an item (task) on the configured Monday.com board.
 * Returns { created: false, reason: 'not_configured' } when MONDAY_API_KEY /
 * MONDAY_BOARD_ID aren't set yet, so callers can still run the rest of the
 * flow (e.g. store the task locally as "pending sync") without throwing.
 * `status`/`priority` may be either the board's own label text (what the
 * manual task form's dropdowns send) or our High/Medium/Low scale (what AI
 * meeting analysis produces) — both are resolved against the board's actual
 * labels. `file`, if given, is { buffer, filename, mimetype }.
 */
async function createTask({ task, owner, due, project, priority, status, file }) {
  if (!isConfigured()) {
    return { created: false, reason: 'not_configured' };
  }

  try {
    const boardId = getBoardId();
    const [columns, groupId] = await Promise.all([getBoardColumns(boardId), getOrCreateTaskGroup(boardId)]);
    const columnValues = {};

    const dateColumn = findColumn(columns, { types: ['date', 'timeline'], titleRegex: /due|date/i });
    const isoDate = toIsoDate(due);
    if (dateColumn && isoDate) {
      columnValues[dateColumn.id] = dateColumn.type === 'timeline'
        ? { from: isoDate, to: isoDate }
        : { date: isoDate };
    }

    // "Status" column (e.g. Methods board's In Progress / Done / Stuck / Not
    // Started) — deliberately scoped to columns literally titled "Status",
    // since the Methods board also has a separate "Priority" status column
    // (Secondary / Later / Top 3), handled below. Explicit status wins; with
    // none given (e.g. a meeting-derived task), default to "not started".
    const statusColumn = findColumn(columns, { types: ['status'], titleRegex: /\bstatus\b/i });
    const statusLabel = status
      ? findLabelExactOrSynonym(statusColumn, status, STATUS_SYNONYMS)
      : findLabelExactOrSynonym(statusColumn, 'todo', STATUS_SYNONYMS);
    if (statusColumn && statusLabel) {
      columnValues[statusColumn.id] = { label: statusLabel };
    }

    const priorityColumn = findColumn(columns, { types: ['status'], titleRegex: /priority/i });
    const priorityLabel = findLabelExactOrSynonym(priorityColumn, priority, PRIORITY_SYNONYMS);
    if (priorityColumn && priorityLabel) {
      columnValues[priorityColumn.id] = { label: priorityLabel };
    }

    // Owner: try to resolve the free-text name to a real Monday user and
    // assign them in the people column directly. Names come from AI-extracted
    // meeting action items, the manual form's owner dropdown, or free entry,
    // so a match isn't guaranteed — when it isn't found, fall back to putting
    // the name in the item title instead of silently dropping it.
    const ownerColumn = findColumn(columns, { types: ['people', 'multiple-person'], titleRegex: /owner|assignee|person/i });
    let ownerAssigned = false;
    if (ownerColumn && owner) {
      const users = await getUsers();
      const matchedUser = findUserByName(users, owner);
      if (matchedUser) {
        columnValues[ownerColumn.id] = { personsAndTeams: [{ id: Number(matchedUser.id), kind: 'person' }] };
        ownerAssigned = true;
      }
    }

    const context = [!ownerAssigned && owner ? `Owner: ${owner}` : null, project ? `Project: ${project}` : null, !isoDate && due ? `Due: ${due}` : null]
      .filter(Boolean)
      .join(' · ');
    const itemName = context ? `${task} (${context})` : task;

    const data = await mondayRequest(
      `mutation ($boardId: ID!, $groupId: String, $itemName: String!, $columnValues: JSON) {
        create_item (board_id: $boardId, group_id: $groupId, item_name: $itemName, column_values: $columnValues) {
          id
        }
      }`,
      { boardId, groupId, itemName, columnValues: JSON.stringify(columnValues) }
    );

    const itemId = data.create_item.id;
    const result = { created: true, itemId, ownerAssigned };

    const fileColumn = findColumn(columns, { types: ['file'], titleRegex: /file/i });
    if (file && fileColumn) {
      try {
        await attachFileToItem(itemId, fileColumn.id, file);
        result.fileAttached = true;
      } catch (err) {
        // The item itself was already created successfully — a failed file
        // attach shouldn't take that down with it.
        result.fileAttached = false;
        result.fileError = err.message;
      }
    }

    return result;
  } catch (err) {
    return { created: false, reason: 'monday_error', error: err.message };
  }
}

// Lists boards the configured Monday.com account can see, so Settings can
// offer a dropdown instead of making an admin hunt down and paste a raw board
// id. Returns [] (rather than throwing) when there's no API key yet, since
// the Settings page still needs to render.
async function listBoards() {
  if (!env.MONDAY_API_KEY) return [];
  const data = await mondayRequest(`query { boards (limit: 100, order_by: created_at) { id name } }`, {});
  return data.boards || [];
}

module.exports = { isConfigured, createTask, getBoardId, listBoards };
