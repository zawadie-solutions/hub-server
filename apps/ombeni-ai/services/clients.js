// Client history: everything a person has heard from one client, across the
// client meetings THEY attended. Pure helpers here; the AI summary call is in
// clientSummary() below.
const OpenAI = require('openai');
const env = require('../config/env');
const { clientKeys } = require('./meetingKind');

/** [{ key, meetings, lastDate, titles }] for the given (already privacy-filtered) meetings, most recent first. */
function listClients(meetings) {
  const byKey = new Map();
  for (const m of meetings) {
    for (const key of clientKeys(m.participants)) {
      const c = byKey.get(key) || { key, meetings: 0, lastDate: '', titles: [] };
      c.meetings += 1;
      if (String(m.date) > c.lastDate) c.lastDate = String(m.date);
      if (c.titles.length < 3 && !c.titles.includes(m.title)) c.titles.push(m.title);
      byKey.set(key, c);
    }
  }
  return [...byKey.values()].sort((a, b) => b.lastDate.localeCompare(a.lastDate));
}

/**
 * Whether the person deleted this client (deletedClients: { [key]: 'YYYY-MM-DD'
 * deleted on }). A meeting with them after that day makes them a client again.
 */
const isDeleted = (client, deletedClients) => {
  const deletedOn = (deletedClients || {})[client.key];
  return Boolean(deletedOn) && String(client.lastDate || '') <= deletedOn;
};

/** The person's client list without the clients they deleted. */
const withoutDeleted = (list, deletedClients) => list.filter(c => !isDeleted(c, deletedClients));

const meetingsFor = (key, meetings) => meetings
  .filter(m => clientKeys(m.participants).includes(key))
  .sort((a, b) => String(b.date).localeCompare(String(a.date)));

const MAX_MEETINGS = 6;
const clean = (v, n = 8) => (Array.isArray(v) ? v.filter(Boolean).slice(0, n) : []);
const str = (v, max = 400) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function summaryPrompt(key, meetings) {
  const context = meetings.slice(0, MAX_MEETINGS).reverse().map(m => {
    const a = m.analysis || {};
    return [
      `MEETING ${m.date}: ${m.title}`,
      a.summary ? `Summary: ${a.summary}` : '',
      a.fullSummary ? `Notes: ${String(a.fullSummary).slice(0, 3000)}` : '',
      (a.decisions || []).length ? `Decisions: ${a.decisions.join(' | ')}` : ''
    ].filter(Boolean).join('\n');
  }).join('\n\n');
  return `These are Zawadie Solutions' meetings with the client ${key}, oldest first. Build a short client history
so a Zawadie employee never forgets or mixes up what this client asked for.

- asked_for: the client's current requirements and requests, newest version of each, with the date it was
  last said (YYYY-MM-DD). Up to 8.
- preferences: how they like to work (tone, formats, timing, who to contact). Up to 5. Only if said.
- changes: anything the client changed their mind on between meetings: what it was before, what it is now,
  and both dates. Only real changes.
- open: questions or promises still open as of the latest meeting. Up to 5.
Use only what's below. Plain text, no Markdown.

Return JSON:
{ "asked_for": [{ "text": "...", "date": "..." }], "preferences": ["..."],
  "changes": [{ "what": "...", "before": "...", "after": "...", "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" }],
  "open": ["..."] }

${context}`;
}

function normalizeSummary(raw) {
  return {
    askedFor: clean(raw && raw.asked_for).map(a => ({ text: str(a.text), date: str(a.date, 10) })).filter(a => a.text),
    preferences: clean(raw && raw.preferences, 5).map(p => str(p)).filter(Boolean),
    // A change of mind between meetings: different dates on each side.
    changes: clean(raw && raw.changes, 6).map(c => ({ what: str(c.what), before: str(c.before), after: str(c.after), from: str(c.from, 10), to: str(c.to, 10) }))
      .filter(c => c.what && c.from && c.to && c.from !== c.to),
    open: clean(raw && raw.open, 5).map(o => str(o)).filter(Boolean)
  };
}

let openai = null;

async function clientSummary(key, meetings) {
  openai = openai || new OpenAI({ apiKey: env.OPENAI_API_KEY });
  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [{ role: 'user', content: summaryPrompt(key, meetings) }]
  });
  return normalizeSummary(JSON.parse(response.choices[0].message.content));
}

module.exports = { listClients, isDeleted, withoutDeleted, meetingsFor, summaryPrompt, normalizeSummary, clientSummary, MAX_MEETINGS };
