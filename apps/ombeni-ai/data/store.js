const seedMeetings = require('./meetings');
const notetakerService = require('../services/notetakerService');

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
  kind: 'company',
  externalDomains: [],
  transcriptEntries: [],
  mondayLink: null,
  durationMinutes: null,
  analysis: null,          // { summary, keyPoints, decisions, actionItems, unresolved } — set by /analyze
  analyzedAt: null
}));
let usingNotetaker = false;
let lastRefreshedAt = 0;

const activityLog = [];

let activitySeq = 1;

// Called with the fresh meeting list after every refresh (see
// services/statementService.js, which writes success statements for new
// meetings). Listeners run in the background: a refresh never waits on them.
const refreshListeners = [];

function onMeetingsRefreshed(listener) {
  refreshListeners.push(listener);
}

async function refreshMeetings() {
  if (!notetakerService.isConfigured()) return meetings;
  meetings = await notetakerService.listMeetings();
  usingNotetaker = true;
  lastRefreshedAt = Date.now();

  for (const listener of refreshListeners) {
    Promise.resolve(listener(meetings)).catch(err => console.error('⚠️ Meeting refresh listener failed:', err.message));
  }

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

// Only listed participants (by email, case-insensitive) may see a meeting. A
// real recording Monday returned no attendee emails for belongs to nobody we
// can name, so nobody sees it; only the fictional demo meetings (standalone,
// no Monday) have no attendees and are open.
function isAuthorizedForMeeting(meeting, email) {
  if (!meeting.participants || meeting.participants.length === 0) return meeting.source === 'demo';
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
  onMeetingsRefreshed,
  logActivity,
  getActivity
};
