// Ombeni as each person's co-worker: every few minutes it looks at the
// calendars of people who connected Google, and sends their morning message
// and their notes before meetings (see coworkerPlan.js for the rules).
//
// Privacy: everything sent to a person is built only from their own calendar,
// the recorded meetings they attended, and their own work.
const OpenAI = require('openai');
const env = require('../config/env');
const people = require('../data/people');
const store = require('../data/store');
const workStore = require('../data/workStore');
const calendarService = require('./calendarService');
const slackService = require('./slackService');
const plan = require('./coworkerPlan');

const MODEL = 'gpt-4o';
let openai = null;
const client = () => (openai = openai || new OpenAI({ apiKey: env.OPENAI_API_KEY }));

const link = (hash) => `${env.APP_URL.endsWith('/') ? env.APP_URL : `${env.APP_URL}/`}#${hash}`;
const meetingsAttendedBy = (email) => store.getMeetings().filter(m => (m.participants || []).length && store.isAuthorizedForMeeting(m, email));

// "Last time" and "worth asking", written from the summaries of the related
// meetings. Never blocks the notes: if the AI fails, they go without it.
async function aiPrepNotes(event, related, mine, waiting, readerName) {
  if (!env.isOpenAIConfigured || !related.length) return null;
  const context = related.map(m => {
    const a = m.analysis || {};
    return [
      `MEETING: ${m.title} (${m.date})`,
      a.summary ? `Summary: ${a.summary}` : '',
      a.fullSummary ? `Notes: ${String(a.fullSummary).slice(0, 3000)}` : '',
      (a.decisions || []).length ? `Decisions: ${a.decisions.join(' | ')}` : ''
    ].filter(Boolean).join('\n');
  }).join('\n\n');
  const unclear = mine.flatMap(a => a.statement.unclear || []);
  try {
    const response = await client().chat.completions.create({
      model: MODEL,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [{
        role: 'user',
        content: `You're preparing ${readerName || 'a Zawadie employee'} for the meeting "${event.title}", which starts soon.
They are reading this: write TO them, using "you" for them. Never write their name${readerName ? ` (${readerName})` : ''} in any bullet.
From the earlier meetings below, write:
- last_time: up to 4 short bullets on what was agreed or decided last time that matters for this meeting.
- questions: up to 4 short questions for them to ask the OTHER people in the meeting: things left open,
  what the others promised, and anything still unclear. Not questions about their own tasks.
Use only what's below. Plain text, no Markdown.
Return JSON: { "last_time": ["..."], "questions": ["..."] }

STILL UNCLEAR IN THEIR OWN WORK:
${unclear.map(u => `- ${u}`).join('\n') || '(none)'}

WAITING ON THE CLIENT:
${waiting.map(w => `- ${w.who}: ${w.what}`).join('\n') || '(none)'}

${context}`
      }]
    });
    const raw = JSON.parse(response.choices[0].message.content);
    const clean = (v) => (Array.isArray(v) ? v.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim().slice(0, 300)).slice(0, 4) : []);
    return { lastTime: clean(raw.last_time), questions: clean(raw.questions) };
  } catch (err) {
    console.error('⚠️ Prep notes AI failed, sending without it:', err.message);
    return null;
  }
}

async function buildPrep(person, event, timeZone) {
  const related = plan.relatedMeetings(event, meetingsAttendedBy(person.email));
  const relatedIds = new Set(related.map(m => m.id));
  const mine = (await workStore.assignmentsForOwner(person.email))
    .filter(a => relatedIds.has(a.meetingId) && a.status !== 'done' && !a.sample);
  const waiting = (await workStore.getBriefs([...relatedIds])).flatMap(b => b.waitingOnClient || []);
  const ai = await aiPrepNotes(event, related, mine, waiting, person.name);
  return plan.prepMessage({ event: { ...event, self: person.email }, timeZone, related, mine, waiting, ai, link: link('work') });
}

async function send(email, message, what) {
  const result = await slackService.sendDirectMessage(email, message);
  if (!result.sent) console.error(`⚠️ ${what} for ${email} not sent: ${result.reason}`);
  return result.sent;
}

async function runForPerson(person, now) {
  const tokens = people.googleTokens(person);
  if (!tokens) return;

  let calendar;
  try {
    calendar = await calendarService.listEventsWithZone(
      tokens,
      new Date(now.getTime() - 60 * 60000).toISOString(),
      new Date(now.getTime() + 24 * 3600000).toISOString()
    );
  } catch (err) {
    // Revoked or expired access: stop trying until they connect again.
    if (/invalid_grant|invalid_token|unauthorized/i.test(err.message)) await people.markGoogleBroken(person.email);
    else console.error(`⚠️ Calendar read failed for ${person.email}:`, err.message);
    return;
  }
  const { timeZone, events } = calendar;
  let record = person.timeZone === timeZone ? person : await people.update(person.email, { timeZone });

  if (plan.shouldSendMorning(record, now, timeZone)) {
    // Recorded first, so a crash can't send it twice.
    record = await people.update(person.email, { lastMorningDate: plan.localParts(now, timeZone).date });
    const message = plan.morningMessage({
      name: record.name, email: record.email, timeZone, now, events,
      // Samples are for trying Ombeni out, not real work to remind anyone of.
      work: (await workStore.assignmentsForOwner(record.email)).filter(a => !a.sample), link: link('work')
    });
    if (message) await send(record.email, message, 'Morning message');
  }

  const due = plan.eventsNeedingPrep(events, record, now);
  if (due.length) {
    const prepped = plan.prunePrepped(record.prepped, now);
    for (const event of due) prepped[plan.prepKey(event)] = now.toISOString();
    record = await people.update(record.email, { prepped });
    for (const event of due) await send(record.email, await buildPrep(record, event, timeZone), `Prep notes for "${event.title}"`);
  }
}

let running = false;

async function tick(now = new Date()) {
  if (running || !env.COWORKER || !env.isSlackDmConfigured || !people.canStoreTokens()) return;
  running = true;
  try {
    await store.ensureFreshMeetings();
    for (const person of await people.list()) {
      try {
        await runForPerson(person, now);
      } catch (err) {
        console.error(`⚠️ Co-worker run failed for ${person.email}:`, err.message);
      }
    }
  } finally {
    running = false;
  }
}

const EVERY_MS = 5 * 60 * 1000;

function start() {
  setTimeout(() => tick().catch(() => {}), 60 * 1000);
  setInterval(() => tick().catch(err => console.error('⚠️ Co-worker tick failed:', err.message)), EVERY_MS);
}

module.exports = { start, tick, runForPerson, buildPrep };
