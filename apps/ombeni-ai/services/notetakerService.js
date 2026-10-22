const env = require('../config/env');

const MONDAY_API_URL = 'https://api.monday.com/v2';

function isConfigured() {
  return env.isNotetakerConfigured;
}

// A bounded timeout so a single unreachable/slow Monday endpoint fails fast
// (caught per-key below) instead of stalling the whole meeting refresh —
// which server.js awaits before it starts listening.
const REQUEST_TIMEOUT_MS = 15000;

async function mondayRequest(query, variables, apiKey = env.MONDAY_API_KEY) {
  const response = await fetch(MONDAY_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: apiKey },
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

// Pulls a markdown-ish "### Decisions & Results\n* bullet\n* bullet" section out
// of Notetaker's free-text summary. Best-effort only — if the heading isn't
// there (format can vary), we just return no decisions rather than guessing.
function extractMarkdownBullets(markdown, headingRegex) {
  if (!markdown) return [];
  const lines = markdown.split('\n');
  const startIdx = lines.findIndex(l => headingRegex.test(l.trim()));
  if (startIdx === -1) return [];
  const bullets = [];
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/^#{2,3}\s/.test(line)) break; // next heading
    if (/^[*-]\s+/.test(line)) bullets.push(line.replace(/^[*-]\s+/, '').trim());
  }
  return bullets;
}

function normalizeMeeting(raw) {
  const topics = (raw.topics || []).filter(t => t.title !== 'DetectedLanguage');
  const keyPoints = topics.map(t => {
    const first = (t.talking_points || [])[0];
    return first ? `${t.title}: ${first.content}` : t.title;
  });

  // `id` is Notetaker's own stable id for the action item — kept (not just
  // its content) so store.syncActionItemsToMonday can tell "already pushed to
  // Monday" apart from "new" across refreshes, which rebuild this whole array
  // from scratch every time.
  const actionItems = (raw.action_items || []).map(ai => ({
    id: ai.id,
    task: ai.content,
    owner: ai.owner || 'Unassigned',
    due: ai.due_date ? ai.due_date.slice(0, 10) : null,
    completed: ai.is_completed
  }));

  const participantEmails = (raw.participants || [])
    .map(p => (p.email || '').toLowerCase())
    .filter(Boolean);

  return {
    id: raw.id,
    title: raw.title,
    date: raw.start_time ? raw.start_time.slice(0, 10) : null,
    project: null,
    source: 'notetaker',
    mondayLink: raw.meeting_link,
    durationMinutes: raw.recording_duration ? Math.round(raw.recording_duration / 1000 / 60) : null,
    participants: participantEmails,
    analysis: {
      summary: raw.gist || '',
      fullSummary: raw.summary || '',
      keyPoints,
      decisions: extractMarkdownBullets(raw.summary, /^#{2,3}\s*Decisions/i),
      actionItems,
      unresolved: []
    }
  };
}

const MEETINGS_QUERY = `query ($limit: Int, $access: MeetingAccessFilter) {
  notetaker {
    meetings(limit: $limit, filters: { access: $access }) {
      meetings {
        id
        title
        start_time
        end_time
        recording_duration
        meeting_link
        gist
        summary
        participants { email }
        topics { title talking_points { content timestamp } }
        action_items { id content is_completed owner due_date }
      }
      page_info { has_next_page cursor }
    }
  }
}`;

/**
 * Lists meetings with completed Notetaker recordings, normalized into the
 * app's internal meeting/analysis shape. access: 'OWN' (default per Monday's
 * API) only returns meetings the token's user owns; 'ALL' includes meetings
 * shared with them too.
 *
 * Queries every configured MONDAY_API_KEY / MONDAY_API_KEY_2 / etc. and
 * merges the results (deduped by meeting id) — a recording only shows up
 * under the Notetaker account that owns or was shared into it, so a single
 * key can miss meetings another teammate's key can see.
 */
async function listMeetings({ limit = 50, access = 'ALL' } = {}) {
  const keys = env.MONDAY_API_KEYS.length ? env.MONDAY_API_KEYS : [env.MONDAY_API_KEY].filter(Boolean);

  const resultsPerKey = await Promise.all(keys.map(async (apiKey) => {
    try {
      const data = await mondayRequest(MEETINGS_QUERY, { limit, access }, apiKey);
      return data.notetaker.meetings.meetings.map(normalizeMeeting);
    } catch (err) {
      console.error('⚠️ Notetaker fetch failed for one MONDAY_API_KEY:', err.message);
      return [];
    }
  }));

  const seen = new Set();
  return resultsPerKey.flat().filter(m => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });
}

module.exports = { isConfigured, listMeetings };
