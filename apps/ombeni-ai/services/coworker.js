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
The meetings below are earlier sessions of this same meeting. From them, write:
- last_time: up to 4 short bullets on what was agreed or decided last time that matters for this meeting.
- questions: up to 4 short questions for them to ask the OTHER people in the meeting: things left open,
  what the others promised, and anything still unclear. Not questions about their own tasks.
Stay on this meeting's own topics: leave out anything from those sessions that belongs to a different
project or meeting. Use only what's below. Plain text, no Markdown.
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

// What Zawadie is for (from zawadie.com). Ideas come from this, not from
// whatever happened to be discussed in recent meetings.
const MISSION = `Zawadie Solutions runs managed AI operations. Its mission: technology should lift people, not replace them - every hour of AI operations it runs also creates paid, skill-building work for displaced professionals. A "Human Intelligence Layer" of skilled operators monitors, validates and improves AI outputs, because AI in production needs an ongoing operational function, accuracy and judgment need people, and operations work should create careers.`;

// One or two of these is each person's theme for the day, so the ideas differ
// from day to day. They are Zawadie's service areas and values.
const FOCUS_AREAS = [
  'Customer Operations: AI chat monitoring, ticket routing, QA, escalation review, knowledge-base updates',
  'Sales Operations: CRM hygiene, lead enrichment, prospect research, outbound QA',
  'Back Office Operations: document processing, HR support, finance workflows, vendor management',
  'Process Automation: workflow automation, SOPs, exception handling, monitoring AI',
  'AI Workforce Enablement: AI adoption, training, SOP development, governance, team enablement',
  'Human Intelligence: improving how operators validate and correct AI outputs, accuracy and quality checks',
  'Opportunity through technology: creating skill-building work and growth paths for the people on the team',
  'Client success: understanding what a client needs from AI operations and showing the value delivered',
  'Quality and accuracy: measuring AI accuracy, finding recurring errors, closing the loop',
  'Knowledge sharing: documenting what works so the whole team can reuse it',
  'Hiring and training operators: onboarding material, practice exercises, coaching',
  'Business development: finding and framing new use cases for managed AI operations'
];
const HISTORY_DAYS = 45;
const HISTORY_MAX = 80;

const words = (t) => new Set(String(t).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 3));
/** True when two idea titles are close enough to count as the same idea. */
function sameIdea(a, b) {
  const x = words(a), y = words(b);
  if (!x.size || !y.size) return false;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  return shared / Math.min(x.size, y.size) >= 0.6;
}

function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Two focus areas for this person on this day: different every day, different for every person. */
function focusFor(email, today) {
  const day = Math.floor(Date.parse(`${today}T12:00:00Z`) / 86400000);
  const start = hash(String(email).toLowerCase()) % FOCUS_AREAS.length;
  const first = (start + day * 2) % FOCUS_AREAS.length;
  return [FOCUS_AREAS[first], FOCUS_AREAS[(first + 1) % FOCUS_AREAS.length]];
}

const recentHistory = (person, today) => {
  const since = new Date(Date.parse(`${today}T12:00:00Z`) - HISTORY_DAYS * 86400000).toISOString().slice(0, 10);
  return (Array.isArray(person.ideaHistory) ? person.ideaHistory : []).filter(h => h && h.title && String(h.date) >= since);
};

// Ideas for the morning message when someone has fewer than four open tasks.
// Built from the company mission, a daily focus for this person, today's
// calendar titles and their own open work. Meeting summaries are deliberately
// not used: they pulled in topics from other clients' meetings. Titles already
// suggested to this person are never repeated. Never blocks the message: if
// the AI fails, it goes without ideas.
async function aiIdeas(person, count, { events, open, today }) {
  if (!env.isOpenAIConfigured || count <= 0) return [];
  const history = recentHistory(person, today);
  const focus = focusFor(person.email, today);
  const ask = async (n, avoid) => {
    const response = await client().chat.completions.create({
      model: MODEL,
      temperature: 0.9,
      response_format: { type: 'json_object' },
      messages: [{
        role: 'user',
        content: `You are Ombeni, a co-worker at Zawadie Solutions. Suggest exactly ${n} idea(s) for ${person.name || 'this employee'} to work on today that would add real value to the company and advance its mission.
They are reading this: write TO them, using "you". Never write their name.

ABOUT ZAWADIE:
${MISSION}

TODAY'S THEMES (draw the ideas from these, one idea per theme where possible):
${focus.map(f => `- ${f}`).join('\n')}

Each idea must:
- be something one person can make real progress on in a day,
- be general to Zawadie's work: do NOT name or assume any specific client, project or meeting,
- be different in subject and wording from every idea under ALREADY SUGGESTED and TO AVOID,
- not repeat a task they already have.
Keep it professional and specific. Plain text, no Markdown, no emoji.
Return JSON: { "ideas": [{ "title": "short action, at most 8 words", "why": "one sentence, at most 25 words, on the value to the company" }] }

TODAY'S MEETINGS (titles only):
${events.map(e => `- ${e.title}`).join('\n') || '(none)'}

THEIR OPEN WORK:
${open.map(a => `- ${a.title}`).join('\n') || '(none)'}

ALREADY SUGGESTED TO THEM IN THE LAST ${HISTORY_DAYS} DAYS:
${history.map(h => `- ${h.title}`).join('\n') || '(none)'}
${avoid.length ? `\nTO AVOID (just rejected as repeats):\n${avoid.map(t => `- ${t}`).join('\n')}` : ''}`
      }]
    });
    const raw = JSON.parse(response.choices[0].message.content);
    const text = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
    return (Array.isArray(raw.ideas) ? raw.ideas : [])
      .map(i => ({ title: text(i && i.title, 120), why: text(i && i.why, 300) }))
      .filter(i => i.title);
  };

  try {
    const taken = [...history.map(h => h.title), ...open.map(a => a.title)];
    const picked = [];
    const rejected = [];
    for (let attempt = 0; attempt < 2 && picked.length < count; attempt++) {
      for (const idea of await ask(count - picked.length + (attempt ? 1 : 0), rejected)) {
        if (picked.length >= count) break;
        if ([...taken, ...picked.map(p => p.title)].some(t => sameIdea(t, idea.title))) rejected.push(idea.title);
        else picked.push(idea);
      }
    }
    if (picked.length) {
      const kept = [...history, ...picked.map(i => ({ date: today, title: i.title }))].slice(-HISTORY_MAX);
      await people.update(person.email, { ideaHistory: kept });
    }
    return picked;
  } catch (err) {
    console.error('⚠️ Morning ideas AI failed, sending without them:', err.message);
    return [];
  }
}

async function buildMorning(person, now, timeZone, events) {
  // Samples are for trying Ombeni out, not real work to remind anyone of.
  const work = (await workStore.assignmentsForOwner(person.email)).filter(a => !a.sample);
  const today = plan.localParts(now, timeZone).date;
  const todays = events.filter(e => !e.declined && (e.isAllDay ? e.start.slice(0, 10) === today : plan.localParts(new Date(e.start), timeZone).date === today));
  const ideas = await aiIdeas(person, plan.ideasWanted(work), { events: todays, open: work.filter(a => a.status !== 'done'), today });
  return plan.morningMessage({ name: person.name, email: person.email, timeZone, now, events, work, ideas, link: link('work') });
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
    await send(record.email, await buildMorning(record, now, timeZone, events), 'Morning message');
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

module.exports = { start, tick, runForPerson, buildPrep, buildMorning, focusFor, sameIdea };
