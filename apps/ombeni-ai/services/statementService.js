// Writes success statements for new meetings and sends each one to the person
// it's for. Runs after every meeting refresh (see store.onMeetingsRefreshed).
const OpenAI = require('openai');
const env = require('../config/env');
const workStore = require('../data/workStore');
const mondayService = require('./mondayService');
const slackService = require('./slackService');
const { isCompanyEmail } = require('./meetingKind');
const { buildPrompt, normalizeStatements, slackMessage } = require('./statements');

const MODEL = 'gpt-4o';
// A meeting that fails (e.g. OpenAI down, or a bad key) is retried once an hour
// for about a day, so a short outage doesn't lose anyone's statements.
const MAX_ATTEMPTS = 24;
const RETRY_AFTER_MS = 60 * 60 * 1000;
// Without STATEMENTS_FROM, a meeting first seen more than this many days after
// it happened is old news and gets no statements (e.g. a Notetaker account
// that was unreachable for a while comes back with its whole history).
const RECENT_DAYS = 7;

let openai = null;
const client = () => (openai = openai || new OpenAI({ apiKey: env.OPENAI_API_KEY }));

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

async function sinceDate() {
  if (env.STATEMENTS_FROM) return env.STATEMENTS_FROM;
  let since = await workStore.getSetting('statements_since');
  if (!since) {
    since = today();
    await workStore.setSetting('statements_since', since);
  }
  return since;
}

function isEligibleMeeting(m, since) {
  if (m.source !== 'notetaker' || !m.date || m.date < since) return false;
  if (!env.STATEMENTS_FROM && m.date < daysAgo(RECENT_DAYS)) return false;
  if (!(m.transcriptEntries || []).length) return false;
  return (m.participants || []).some(e => isCompanyEmail(e));
}

// The Zawadie people work can go to: the company directory from Monday plus
// this meeting's Zawadie attendees (who may not be in Monday).
async function peopleFor(meeting) {
  let directory = [];
  try {
    directory = (await mondayService.listPeople()).filter(p => isCompanyEmail(p.email));
  } catch (err) {
    console.error('⚠️ Could not read the Monday user directory:', err.message);
  }
  const byEmail = new Map(directory.map(p => [p.email.toLowerCase(), { name: p.name, email: p.email.toLowerCase() }]));
  for (const email of meeting.participants || []) {
    if (isCompanyEmail(email) && !byEmail.has(email)) byEmail.set(email, { name: null, email });
  }
  // Attendees first: they're the likeliest owners.
  const attendees = new Set(meeting.participants || []);
  return [...byEmail.values()].sort((a, b) => Number(attendees.has(b.email)) - Number(attendees.has(a.email)));
}

function appLink(assignmentId) {
  const base = env.APP_URL.endsWith('/') ? env.APP_URL : `${env.APP_URL}/`;
  return `${base}#work/${assignmentId}`;
}

async function notifyOwner(assignment) {
  if (!assignment.ownerEmail) return null;
  if (!env.SEND_SLACK_DMS) return { status: 'not_sent', reason: 'Slack messages are switched off', at: new Date().toISOString() };
  const result = await slackService.sendDirectMessage(assignment.ownerEmail, slackMessage(assignment, appLink(assignment.id)));
  return { status: result.sent ? 'sent' : 'not_sent', reason: result.reason || null, at: new Date().toISOString() };
}

async function writeStatements(meeting) {
  const people = await peopleFor(meeting);
  const response = await client().chat.completions.create({
    model: MODEL,
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [{ role: 'user', content: buildPrompt(meeting, people) }]
  });
  return normalizeStatements(JSON.parse(response.choices[0].message.content), people.map(p => p.email), meeting);
}

async function processMeeting(meeting, previous) {
  const attempts = ((previous && previous.attempts) || 0) + 1;
  let result;
  try {
    result = await writeStatements(meeting);
  } catch (err) {
    console.error(`⚠️ Could not write success statements for "${meeting.title}":`, err.message);
    await workStore.saveBrief({ meetingId: meeting.id, status: 'failed', attempts, error: err.message });
    return;
  }

  // Saved before anything is sent, so a crash part-way can't make the next run
  // write (and DM) the same statements a second time.
  await workStore.saveBrief({
    meetingId: meeting.id,
    status: 'done',
    attempts,
    kind: meeting.kind,
    externalDomains: meeting.externalDomains,
    waitingOnClient: result.waitingOnClient,
    assignmentCount: result.assignments.length
  });

  for (const a of result.assignments) {
    let assignment = await workStore.saveAssignment({
      ...a,
      meetingId: meeting.id,
      meetingTitle: meeting.title,
      meetingDate: meeting.date,
      status: 'new',
      declinedBy: [],
      slack: null,
      monday: null
    });
    const slack = await notifyOwner(assignment);
    if (slack) assignment = await workStore.saveAssignment({ ...assignment, slack });
  }
  console.log(`✅ Success statements for "${meeting.title}": ${result.assignments.length} assignment(s)`);
}

function shouldRetry(brief, now = Date.now()) {
  if (brief.status !== 'failed' || brief.attempts >= MAX_ATTEMPTS) return false;
  return now - new Date(brief.updatedAt).getTime() >= RETRY_AFTER_MS;
}

let running = false;

/** Writes statements for every eligible meeting that doesn't have them yet, one at a time. */
async function processNewMeetings(meetings) {
  if (running || !env.isOpenAIConfigured || !meetings.length) return;
  running = true;
  try {
    const since = await sinceDate();
    for (const meeting of meetings.filter(m => isEligibleMeeting(m, since))) {
      const brief = await workStore.getBrief(meeting.id);
      if (brief && !shouldRetry(brief)) continue;
      await processMeeting(meeting, brief);
    }
  } finally {
    running = false;
  }
}

module.exports = { processNewMeetings, isEligibleMeeting, shouldRetry, appLink, writeStatements };
