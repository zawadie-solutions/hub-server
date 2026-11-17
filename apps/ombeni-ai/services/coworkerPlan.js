// The pure parts of Ombeni as a co-worker: when to send what, which past
// meetings matter for an upcoming one, and how the Slack messages read. No
// network calls here (see coworker.js), so it can be tested directly.
const { isCompanyEmail, clientKeys } = require('./meetingKind');

const MORNING_FROM = 7 * 60 + 30; // 7:30
const MORNING_UNTIL = 11 * 60;    // a server that was down at 7:30 still sends until 11:00
const PREP_LEAD_MINUTES = 35;     // prep notes go out up to this long before a meeting
const RELATED_MEETINGS = 3;

/** The wall-clock date and time in a time zone: { date: 'YYYY-MM-DD', minutes, weekday (0 = Sunday) }. */
function localParts(now, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23'
  }).formatToParts(now).map(p => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday)
  };
}

const prefOn = (person, name) => !(person.prefs && person.prefs[name] === false);

function shouldSendMorning(person, now, timeZone) {
  if (!prefOn(person, 'morning')) return false;
  const local = localParts(now, timeZone);
  if (local.weekday === 0 || local.weekday === 6) return false;
  if (local.minutes < MORNING_FROM || local.minutes >= MORNING_UNTIL) return false;
  return person.lastMorningDate !== local.date;
}

const prepKey = (event) => `${event.id}@${event.start}`;

/** Meetings starting soon that this person is going to, with someone else, and hasn't had notes for. */
function eventsNeedingPrep(events, person, now) {
  if (!prefOn(person, 'prep')) return [];
  const prepped = person.prepped || {};
  return events.filter(e => {
    if (e.isAllDay || e.declined) return false;
    const minutesAway = (Date.parse(e.start) - now.getTime()) / 60000;
    if (minutesAway <= 0 || minutesAway > PREP_LEAD_MINUTES) return false;
    if (e.attendees.filter(a => a !== person.email).length === 0) return false;
    return !prepped[prepKey(e)];
  });
}

// Drops records of notes sent more than three days ago.
function prunePrepped(prepped, now) {
  const cutoff = now.getTime() - 3 * 86400000;
  return Object.fromEntries(Object.entries(prepped || {}).filter(([, at]) => Date.parse(at) >= cutoff));
}

const normTitle = (t) => String(t || '').toLowerCase().replace(/\d{1,4}[/.-]\d{1,2}([/.-]\d{1,4})?/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Past recorded meetings that matter for an upcoming one: the same client
 * (an outside email domain in common), a recurring meeting (same title), or
 * mostly the same Zawadie people. `meetings` must already be only the ones
 * this person attended. Newest first.
 */
function relatedMeetings(event, meetings) {
  const external = new Set(clientKeys(event.attendees));
  const internal = new Set(event.attendees.filter(a => isCompanyEmail(a)));
  const title = normTitle(event.title);
  return meetings
    .filter(m => {
      if (external.size) return clientKeys(m.participants).some(k => external.has(k));
      if (title && normTitle(m.title) === title) return true;
      const overlap = (m.participants || []).filter(p => internal.has(p)).length;
      return internal.size >= 2 && overlap >= 2 && overlap / internal.size >= 0.6;
    })
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .slice(0, RELATED_MEETINGS);
}

// ---- Slack messages ----

const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const section = (text) => ({ type: 'section', text: { type: 'mrkdwn', text: text.slice(0, 2900) } });
const firstName = (name, email) => (name || String(email).split('@')[0].split(/[._-]/)[0]).split(' ')[0].replace(/^./, c => c.toUpperCase());

function clockTime(iso, timeZone) {
  return new Date(iso).toLocaleTimeString('en-US', { timeZone, hour: 'numeric', minute: '2-digit' });
}

function shortDate(iso) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function addDays(iso, n) {
  return new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
}

const clientLabel = (attendees) => {
  const domains = clientKeys(attendees);
  return domains.length ? `  _(client: ${esc(domains.join(', '))})_` : '';
};

/**
 * The morning message, or null when there's nothing to say (no meetings and
 * no open work): Ombeni doesn't message people just to say hello.
 */
function morningMessage({ name, email, timeZone, now, events, work, link }) {
  const today = localParts(now, timeZone).date;
  const todays = events
    .filter(e => !e.declined && (e.isAllDay ? e.start.slice(0, 10) === today : localParts(new Date(e.start), timeZone).date === today))
    .sort((a, b) => String(a.start).localeCompare(String(b.start)));

  const open = work.filter(a => a.status !== 'done');
  const due = (a) => a.statement && a.statement.due;
  const overdue = open.filter(a => due(a) && due(a) < today);
  const dueToday = open.filter(a => due(a) === today);
  const dueSoon = open.filter(a => due(a) && due(a) > today && due(a) <= addDays(today, 3));
  const fresh = open.filter(a => a.status === 'new' && !overdue.includes(a) && !dueToday.includes(a) && !dueSoon.includes(a));
  const toFix = open.filter(a => (a.checks || [])[0] && !a.checks[0].result.ready);

  if (!todays.length && !overdue.length && !dueToday.length && !dueSoon.length && !fresh.length && !toFix.length) return null;

  const weekday = new Date(`${today}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
  const item = (a, extra = '') => `•  ${esc(a.title)}${extra}  _(from ${esc(a.meetingTitle)})_`;
  const blocks = [section(`*Good morning, ${esc(firstName(name, email))}.* Here's your ${esc(weekday)}.`)];

  if (todays.length) {
    blocks.push(section(`*Meetings today*\n${todays.map(e => `•  ${e.isAllDay ? 'All day' : esc(clockTime(e.start, timeZone))}  ${esc(e.title)}${clientLabel(e.attendees)}`).join('\n')}`));
  }
  const workLines = [
    ...overdue.map(a => item(a, `  *overdue since ${esc(shortDate(due(a)))}*`)),
    ...dueToday.map(a => item(a, '  *due today*')),
    ...dueSoon.map(a => item(a, `  due ${esc(shortDate(due(a)))}`)),
    ...fresh.map(a => item(a, '  new, not read yet'))
  ];
  if (workLines.length) blocks.push(section(`*Your work*\n${workLines.join('\n')}`));
  if (toFix.length) blocks.push(section(`*Last check found things to fix*\n${toFix.map(a => item(a)).join('\n')}`));
  blocks.push({ type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Open My Work' }, url: link, style: 'primary' }] });

  const summary = [todays.length && `${todays.length} meeting(s)`, (overdue.length + dueToday.length) && `${overdue.length + dueToday.length} due`].filter(Boolean).join(', ');
  return { text: `Good morning. Your day: ${summary || 'open work in Ombeni'}.`, blocks };
}

/**
 * Notes before a meeting. related: past meetings (this person attended);
 * mine: their own open work from those meetings; waiting: what the client
 * promised; ai: { lastTime: [...], questions: [...] } or null.
 */
function prepMessage({ event, timeZone, related, mine, waiting, ai, link }) {
  const people = event.attendees.filter(a => a !== event.self);
  const outside = people.filter(a => !isCompanyEmail(a));
  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: `Prep: ${event.title}`.slice(0, 150) } },
    { type: 'context', elements: [{ type: 'mrkdwn', text: `${esc(clockTime(event.start, timeZone))} · ${people.length} other attendee(s)${outside.length ? ` · client: ${esc(clientKeys(outside).join(', '))}` : ''}` }] }
  ];

  if (!related.length) {
    blocks.push(section(outside.length
      ? '*First recorded meeting with this client.* Nothing from earlier meetings to bring up, so listen for exact requirements, deadlines and who gets what.'
      : 'No earlier recorded meetings like this one.'));
  } else {
    blocks.push(section(`*Based on:* ${related.map(m => `${esc(m.title)} (${esc(shortDate(m.date))})`).join(', ')}`));
    if (ai && ai.lastTime.length) blocks.push(section(`*Last time*\n${ai.lastTime.map(l => `•  ${esc(l)}`).join('\n')}`));
  }
  if (mine.length) {
    blocks.push(section(`*Still open on your side*\n${mine.map(a => `•  ${esc(a.title)}${a.statement.due ? `  (due ${esc(shortDate(a.statement.due))})` : ''}${a.status === 'done' ? '  done' : ''}`).join('\n')}`));
  }
  if (waiting.length) blocks.push(section(`*Waiting on them*\n${waiting.map(w => `•  ${esc(w.who ? `${w.who}: ` : '')}${esc(w.what)}`).join('\n')}`));
  if (ai && ai.questions.length) blocks.push(section(`*Worth asking*\n${ai.questions.map(q => `•  ${esc(q)}`).join('\n')}`));
  blocks.push({ type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Open My Work' }, url: link }] });
  return { text: `Prep for ${event.title} at ${clockTime(event.start, timeZone)}`, blocks };
}

module.exports = {
  localParts, shouldSendMorning, eventsNeedingPrep, prepKey, prunePrepped, relatedMeetings,
  morningMessage, prepMessage, PREP_LEAD_MINUTES
};
