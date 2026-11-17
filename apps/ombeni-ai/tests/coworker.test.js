// Phase 3: Ombeni as a co-worker. Scheduling rules, messages, privacy.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ombeni-coworker-'));
process.env.OMBENI_WORK_STORE_FILE = path.join(dir, 'work.json');
process.env.OMBENI_PEOPLE_FILE = path.join(dir, 'people.json');
process.env.TOKEN_KEY = 'test-token-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test';
process.env.SLACK_BOT_TOKEN = 'xoxb-test';

const plan = require('../services/coworkerPlan');
const people = require('../data/people');
const { rawMessage } = require('../services/gmailService');
const { listClients, meetingsFor, normalizeSummary } = require('../services/clients');
const { clientKeys } = require('../services/meetingKind');

const KIT = 'kit@zawadie.com';

// ---- stored Google access ----

test('Google access is stored encrypted and only readable with the key', async () => {
  await people.saveGoogle(KIT, { refresh_token: '1//secret-refresh', scope: 'openid https://www.googleapis.com/auth/gmail.compose' }, 'Kit Alimasi');
  const raw = fs.readFileSync(process.env.OMBENI_PEOPLE_FILE, 'utf8');
  assert.doesNotMatch(raw, /secret-refresh/);
  const person = await people.get(KIT);
  assert.equal(person.name, 'Kit Alimasi');
  assert.equal(people.googleTokens(person).refresh_token, '1//secret-refresh');
  assert.match(people.googleTokens(person).scope, /gmail\.compose/);

  const tampered = { ...person, google: { ...person.google, enc: person.google.enc.replace(/.$/, c => (c === 'A' ? 'B' : 'A')) } };
  assert.equal(people.googleTokens(tampered), null);

  await people.markGoogleBroken(KIT);
  assert.equal(people.googleTokens(await people.get(KIT)), null, 'broken access is not used');
  await people.forgetGoogle(KIT);
  assert.equal((await people.get(KIT)).google, null);
});

// ---- when to send ----

const at = (iso) => new Date(iso);

test('the morning message goes out on weekdays from 7:30 in the person\'s own time zone, once a day', () => {
  const person = { email: KIT, prefs: {} };
  // 2026-11-17 is a Tuesday. 12:45 UTC = 7:45 in New York.
  assert.equal(plan.shouldSendMorning(person, at('2026-11-17T12:45:00Z'), 'America/New_York'), true);
  assert.equal(plan.shouldSendMorning(person, at('2026-11-17T12:15:00Z'), 'America/New_York'), false, '7:15 is too early');
  assert.equal(plan.shouldSendMorning(person, at('2026-11-17T04:45:00Z'), 'Africa/Nairobi'), true, '7:45 in Nairobi');
  assert.equal(plan.shouldSendMorning({ ...person, lastMorningDate: '2026-11-17' }, at('2026-11-17T12:45:00Z'), 'America/New_York'), false);
  assert.equal(plan.shouldSendMorning({ ...person, prefs: { morning: false } }, at('2026-11-17T12:45:00Z'), 'America/New_York'), false);
  assert.equal(plan.shouldSendMorning(person, at('2026-11-21T12:45:00Z'), 'America/New_York'), false, 'Saturday');
});

const event = (o) => ({ id: 'e1', title: 'Kenect sync', start: '2026-11-17T15:00:00Z', isAllDay: false, declined: false, attendees: [KIT, 'wendy@kenect.com'], ...o });

test('prep notes: meetings starting within ~35 minutes, with someone else, not declined, once', () => {
  const now = at('2026-11-17T14:30:00Z');
  const person = { email: KIT, prefs: {} };
  assert.equal(plan.eventsNeedingPrep([event()], person, now).length, 1);
  assert.equal(plan.eventsNeedingPrep([event({ start: '2026-11-17T15:30:00Z' })], person, now).length, 0, 'an hour away');
  assert.equal(plan.eventsNeedingPrep([event({ start: '2026-11-17T14:20:00Z' })], person, now).length, 0, 'already started');
  assert.equal(plan.eventsNeedingPrep([event({ declined: true })], person, now).length, 0);
  assert.equal(plan.eventsNeedingPrep([event({ isAllDay: true })], person, now).length, 0);
  assert.equal(plan.eventsNeedingPrep([event({ attendees: [KIT] })], person, now).length, 0, 'nobody else');
  assert.equal(plan.eventsNeedingPrep([event()], { ...person, prepped: { [plan.prepKey(event())]: now.toISOString() } }, now).length, 0);
  assert.equal(plan.eventsNeedingPrep([event()], { ...person, prefs: { prep: false } }, now).length, 0);
  const moved = event({ start: '2026-11-17T15:05:00Z' });
  assert.equal(plan.eventsNeedingPrep([moved], { ...person, prepped: { [plan.prepKey(event())]: now.toISOString() } }, now).length, 1, 'a rescheduled meeting gets fresh notes');
});

test('old prep records are dropped after three days', () => {
  const now = at('2026-11-17T14:30:00Z');
  assert.deepEqual(Object.keys(plan.prunePrepped({ a: '2026-11-13T10:00:00Z', b: '2026-11-16T10:00:00Z' }, now)), ['b']);
});

// ---- which past meetings matter ----

const m = (id, o) => ({ id, title: 'Weekly sync', date: '2026-11-01', participants: [], externalDomains: [], ...o });

test('related meetings: same client, same recurring meeting, or mostly the same people', () => {
  const meetings = [
    m('kenect-old', { date: '2026-10-01', participants: [KIT, 'wendy@kenect.com'] }),
    m('kenect-new', { date: '2026-11-04', participants: [KIT, 'jess@kenect.com'] }),
    m('other-client', { participants: [KIT, 'x@acme.com'] }),
    m('gmail-alice', { participants: [KIT, 'alice@gmail.com'] }),
    m('gmail-bob', { participants: [KIT, 'bob@gmail.com'] }),
    m('huddle', { title: 'Department Huddle 11/10', participants: [KIT, 'a@zawadie.com'] }),
    m('team', { title: 'Something else', participants: [KIT, 'a@zawadie.com', 'b@zawadie.com'] })
  ];
  assert.deepEqual(plan.relatedMeetings(event(), meetings).map(x => x.id), ['kenect-new', 'kenect-old']);
  assert.deepEqual(plan.relatedMeetings(event({ attendees: [KIT, 'alice@gmail.com'] }), meetings).map(x => x.id), ['gmail-alice'], 'free mail is matched per person, not per domain');
  assert.deepEqual(plan.relatedMeetings(event({ title: 'Department Huddle 11/17', attendees: [KIT, 'z@zawadie.com'] }), meetings).map(x => x.id), ['huddle']);
  // Both share at least 60% of the people (2 of 3, 3 of 3).
  assert.deepEqual(plan.relatedMeetings(event({ title: 'New topic', attendees: [KIT, 'a@zawadie.com', 'b@zawadie.com'] }), meetings).map(x => x.id), ['huddle', 'team']);
  assert.deepEqual(plan.relatedMeetings(event({ title: 'New topic', attendees: [KIT, 'a@zawadie.com', 'b@zawadie.com', 'c@zawadie.com', 'd@zawadie.com', 'e@zawadie.com'] }), meetings).map(x => x.id), [], 'at most half the people in common');
});

// ---- messages ----

const work = (o) => ({ id: 'w', title: 'Draft proposal', meetingTitle: 'Kenect sync', status: 'confirmed', statement: { due: null, unclear: [] }, ...o });

test('no morning message when there is nothing to say', () => {
  assert.equal(plan.morningMessage({ name: 'Kit Alimasi', email: KIT, timeZone: 'UTC', now: at('2026-11-17T08:00:00Z'), events: [], work: [work({ status: 'done' })], link: 'x' }), null);
});

test('the morning message lists today\'s meetings and work that is overdue, due or new', () => {
  const msg = plan.morningMessage({
    name: 'Kit Alimasi', email: KIT, timeZone: 'UTC', now: at('2026-11-17T08:00:00Z'), link: 'https://x/#work',
    events: [event({ start: '2026-11-17T15:00:00Z' }), event({ id: 'tomorrow', title: 'Tomorrow thing', start: '2026-11-18T15:00:00Z' }), event({ id: 'no', title: 'Declined one', declined: true })],
    work: [
      work({ title: 'Late <thing>', statement: { due: '2026-11-15' } }),
      work({ title: 'Today thing', statement: { due: '2026-11-17' } }),
      work({ title: 'Fresh thing', status: 'new', statement: {} }),
      work({ title: 'Fix me', checks: [{ result: { ready: false } }], statement: {} })
    ]
  });
  const all = JSON.stringify(msg.blocks);
  assert.match(all, /Good morning, Kit/);
  assert.match(all, /3:00 PM  Kenect sync  _\(client: kenect\.com\)_/);
  assert.doesNotMatch(all, /Tomorrow thing|Declined one/);
  assert.match(all, /Late &lt;thing&gt;.*overdue since Sun, Nov 15/);
  assert.match(all, /Today thing.*due today/);
  assert.match(all, /Fresh thing.*new, not read yet/);
  assert.match(all, /Last check found things to fix.*Fix me/);
});

test('prep notes say when it\'s the first meeting with a client', () => {
  const msg = plan.prepMessage({ event: { ...event(), self: KIT }, timeZone: 'UTC', related: [], mine: [], waiting: [], ai: null, link: 'x' });
  assert.match(JSON.stringify(msg.blocks), /First recorded meeting with this client/);
});

// ---- Gmail drafts ----

test('a draft email is built correctly and bad addresses are dropped', () => {
  const raw = Buffer.from(rawMessage({ to: ['Wendy@Kenect.com', 'not an email', 'wendy@kenect.com'], subject: 'Récap: Kenect', body: 'Hello Wendy,\nThanks!' }), 'base64url').toString('utf8');
  assert.match(raw, /^To: wendy@kenect\.com\r\n/);
  assert.match(raw, /Subject: =\?UTF-8\?B\?/);
  const body = raw.split('\r\n\r\n')[1].replace(/\r\n/g, '');
  assert.equal(Buffer.from(body, 'base64').toString('utf8'), 'Hello Wendy,\nThanks!');
});

// ---- client history ----

test('clients are grouped by company domain, and by person on free mail', () => {
  assert.deepEqual(clientKeys([KIT, 'Wendy@Kenect.com', 'jess@kenect.com', 'Alice@Gmail.com']), ['kenect.com', 'alice@gmail.com']);
  const meetings = [
    m('a', { date: '2026-11-04', participants: [KIT, 'wendy@kenect.com'] }),
    m('b', { date: '2026-11-10', participants: [KIT, 'jess@kenect.com', 'x@acme.com'] }),
    m('c', { date: '2026-11-01', participants: [KIT, 'alice@gmail.com'] })
  ];
  assert.deepEqual(listClients(meetings).map(c => `${c.key}:${c.meetings}:${c.lastDate}`), ['kenect.com:2:2026-11-10', 'acme.com:1:2026-11-10', 'alice@gmail.com:1:2026-11-01']);
  assert.deepEqual(meetingsFor('kenect.com', meetings).map(x => x.id), ['b', 'a']);
});

test('a client summary is cleaned before it is shown', () => {
  const s = normalizeSummary({ asked_for: [{ text: 'Weekly reports', date: '2026-11-04' }, { date: 'x' }], changes: [{ what: 'Report cadence', before: 'weekly', after: 'biweekly', from: '2026-11-04', to: '2026-11-10' }], preferences: 'not a list', open: ['Insurance?'] });
  assert.deepEqual(s.askedFor, [{ text: 'Weekly reports', date: '2026-11-04' }]);
  assert.equal(s.changes[0].after, 'biweekly');
  assert.deepEqual(s.preferences, []);
  assert.deepEqual(s.open, ['Insurance?']);
});
