const seedMeetings = require('./meetings');
const notetakerService = require('../services/notetakerService');
const mondayService = require('../services/mondayService');
const syncedActionItems = require('./syncedActionItems');

// In-memory application state. Swap this out for a real database once the
// app needs to persist across restarts / multiple instances.
//
// Meetings start out as the fictional seed set (source: 'demo' — used only
// when Monday isn't configured, so the app still runs standalone). Once
// Monday is configured, refreshMeetings() replaces this with the real
// Notetaker recordings, which arrive already analyzed.
let meetings = seedMeetings.map(m => ({
  ...m,
  source: 'demo',
  participants: [],       // demo meetings have names, not emails, so nothing to authorize against
  mondayLink: null,
  durationMinutes: null,
  analysis: null,          // { summary, keyPoints, decisions, actionItems, unresolved } — set by /analyze
  analyzedAt: null
}));
let usingNotetaker = false;
let lastRefreshedAt = 0;

const activityLog = [];

let activitySeq = 1;

// Pushes a meeting's not-yet-completed, not-yet-synced action items to
// Monday.com as tasks — this is what makes task creation automatic instead
// of requiring someone to open the meeting and click a button. Safe to call
// repeatedly on the same meeting: syncedActionItems persists which items
// already made it to Monday, so re-running this on every refresh only ever
// pushes what's actually new (and retries ones that failed, e.g. because
// Monday wasn't configured yet at the time).
async function syncActionItemsToMonday(meeting) {
  const items = meeting.analysis && meeting.analysis.actionItems;
  if (!Array.isArray(items)) return;

  for (const item of items) {
    if (item.completed) continue;
    const key = `${meeting.id}::${item.id || item.task}`;
    if (syncedActionItems.has(key)) continue;

    const mondayResult = await mondayService.createTask({
      task: item.task,
      owner: item.owner,
      due: item.due,
      project: meeting.project,
      priority: item.priority
    });
    item.mondayResult = mondayResult;

    if (mondayResult.created) {
      syncedActionItems.markSynced(key);
      logActivity({
        action: `Created task "${item.task}" in Monday.com from "${meeting.title}"`,
        source: 'Monday.com'
      });
    }
  }
}

// Fire-and-forget: pushes every given meeting's action items to Monday, one
// meeting at a time. Deliberately NOT awaited by refreshMeetings() below —
// callers (including server.js at startup) need the meeting list back
// quickly, and shouldn't be stuck waiting on a potentially long chain of
// Monday API calls (one create_item mutation per unsynced action item) just
// to get it.
async function syncAllActionItems(meetingsList) {
  for (const meeting of meetingsList) {
    try {
      await syncActionItemsToMonday(meeting);
    } catch (err) {
      console.error(`⚠️ Failed to sync action items for meeting "${meeting.title}":`, err.message);
    }
  }
}

async function refreshMeetings() {
  if (!notetakerService.isConfigured()) return meetings;
  meetings = await notetakerService.listMeetings();
  usingNotetaker = true;
  lastRefreshedAt = Date.now();

  syncAllActionItems(meetings).catch(err => console.error('⚠️ Monday action-item sync failed:', err.message));

  return meetings;
}

// Refreshes only if the cached list is older than maxAgeMs — so a burst of
// requests (e.g. someone typing several Ask Ombeni messages in a row) doesn't
// hit Monday's API every time, but a meeting that just finished recording
// shows up within a couple minutes of being asked about, not just on the
// 5-minute background timer or a manual click.
async function ensureFreshMeetings(maxAgeMs = 120000) {
  if (!notetakerService.isConfigured()) return meetings;
  if (Date.now() - lastRefreshedAt > maxAgeMs) {
    try {
      await refreshMeetings();
    } catch (err) {
      console.error('⚠️ On-demand meeting refresh failed, using cached data:', err.message);
    }
  }
  return meetings;
}

function isUsingNotetaker() {
  return usingNotetaker;
}

function getMeetings() {
  return meetings;
}

function getMeeting(id) {
  return meetings.find(m => m.id === id);
}

// A meeting with no known participant emails (demo data, or a Notetaker
// meeting Monday didn't return attendee emails for) is treated as open —
// there's nothing real to restrict. Otherwise only listed participants
// (by email, case-insensitive) are authorized.
function isAuthorizedForMeeting(meeting, email) {
  if (!meeting.participants || meeting.participants.length === 0) return true;
  if (!email) return false;
  return meeting.participants.includes(email.toLowerCase());
}

// Returns the meetings actually removed, so callers can log/report an
// accurate count even if some ids didn't match anything.
function deleteMeetings(ids) {
  const idSet = new Set(ids);
  const removed = meetings.filter(m => idSet.has(m.id));
  meetings = meetings.filter(m => !idSet.has(m.id));
  return removed;
}

function setMeetingAnalysis(id, analysis) {
  const meeting = getMeeting(id);
  if (!meeting) return null;
  meeting.analysis = analysis;
  meeting.analyzedAt = new Date().toISOString();
  return meeting;
}

function logActivity({ user, action, source, result }) {
  const entry = {
    id: activitySeq++,
    user: user || 'Ombeni AI',
    action,
    source: source || 'System',
    result: result || 'Success',
    time: new Date().toISOString()
  };
  activityLog.unshift(entry);
  return entry;
}

function getActivity() {
  return activityLog;
}

module.exports = {
  refreshMeetings,
  ensureFreshMeetings,
  isUsingNotetaker,
  getMeetings,
  getMeeting,
  isAuthorizedForMeeting,
  deleteMeetings,
  setMeetingAnalysis,
  syncActionItemsToMonday,
  logActivity,
  getActivity
};
