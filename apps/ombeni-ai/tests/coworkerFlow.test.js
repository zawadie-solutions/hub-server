// Phase 3 end to end with Google, Slack and OpenAI stubbed: what gets sent,
// when, and that nothing comes from meetings the person wasn't in.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ombeni-flow-'));
process.env.OMBENI_WORK_STORE_FILE = path.join(dir, 'work.json');
process.env.OMBENI_PEOPLE_FILE = path.join(dir, 'people.json');
process.env.TOKEN_KEY = 'test-token-key';
process.env.OPENAI_API_KEY = ''; // no AI: notes go out without the AI part
process.env.SLACK_BOT_TOKEN = 'xoxb-test';
process.env.ZAWADIE_SSO_SECRET = 'x'; // an identity source, so the API isn't in open mode

const express = require('express');
const store = require('../data/store');
const people = require('../data/people');
const workStore = require('../data/workStore');
const calendarService = require('../services/calendarService');
const slackService = require('../services/slackService');
const coworker = require('../services/coworker');

const KIT = 'kit@zawadie.com';
const TYLER = 'tyler@zawadie.com';

const meetings = [
  { id: 'k1', title: 'Kenect quarterly', date: '2026-11-04', source: 'notetaker', kind: 'client', participants: [KIT, 'wendy@kenect.com'], externalDomains: ['kenect.com'], analysis: { summary: 'Kit heard about weekly reports.' } },
  { id: 'k2', title: 'Kenect pricing (Tyler only)', date: '2026-11-10', source: 'notetaker', kind: 'client', participants: [TYLER, 'wendy@kenect.com'], externalDomains: ['kenect.com'], analysis: { summary: 'SECRET pricing talk' } }
];
store.getMeetings = () => meetings;
store.getMeeting = (id) => meetings.find(m => m.id === id);
store.ensureFreshMeetings = async () => meetings;

const sent = [];
slackService.sendDirectMessage = async (email, message) => { sent.push({ email, text: JSON.stringify(message) }); return { sent: true }; };

let calendar = { timeZone: 'UTC', events: [] };
let calendarError = null;
calendarService.listEventsWithZone = async () => { if (calendarError) throw calendarError; return calendar; };

const soon = (now, minutes) => new Date(now.getTime() + minutes * 60000).toISOString();

test.before(async () => {
  await people.saveGoogle(KIT, { refresh_token: 'r', scope: 'openid' }, 'Kit Alimasi');
  await workStore.saveAssignment({ meetingId: 'k1', meetingTitle: 'Kenect quarterly', meetingDate: '2026-11-04', ownerEmail: KIT, title: 'Send weekly report', statement: { due: '2026-11-17', unclear: [] }, status: 'confirmed' });
  await workStore.saveAssignment({ meetingId: 'k2', meetingTitle: 'Kenect pricing', ownerEmail: TYLER, title: 'SECRET Tyler task', statement: { due: null, unclear: [] }, status: 'new' });
  await workStore.saveBrief({ meetingId: 'k2', status: 'done', waitingOnClient: [{ who: 'Wendy', what: 'SECRET price list' }] });
});

test('morning message: sent once, at 7:30+ on a weekday, with today\'s meetings and due work', async () => {
  const now = new Date('2026-11-17T08:00:00Z'); // Tuesday, 8:00 UTC
  calendar = { timeZone: 'UTC', events: [{ id: 'e1', title: 'Kenect check-in', start: soon(now, 300), isAllDay: false, declined: false, attendees: [KIT, 'wendy@kenect.com'] }] };
  await coworker.runForPerson(await people.get(KIT), now);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].email, KIT);
  assert.match(sent[0].text, /Good morning, Kit/);
  assert.match(sent[0].text, /Kenect check-in/);
  assert.match(sent[0].text, /Send weekly report.*due today/);
  assert.doesNotMatch(sent[0].text, /SECRET/);

  await coworker.runForPerson(await people.get(KIT), new Date('2026-11-17T08:05:00Z'));
  assert.equal(sent.length, 1, 'not twice the same day');
});

test('prep notes: sent once before the meeting, built only from meetings the person attended', async () => {
  sent.length = 0;
  const now = new Date('2026-11-17T14:30:00Z');
  calendar = { timeZone: 'UTC', events: [{ id: 'e1', title: 'Kenect check-in', start: soon(now, 25), isAllDay: false, declined: false, attendees: [KIT, 'wendy@kenect.com'] }] };
  await coworker.runForPerson(await people.get(KIT), now);
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /Prep: Kenect check-in/);
  assert.match(sent[0].text, /Based on:.*Kenect quarterly/);
  assert.match(sent[0].text, /Still open on your side.*Send weekly report/);
  assert.doesNotMatch(sent[0].text, /SECRET|Tyler only/, 'nothing from Tyler\'s meeting or work');

  await coworker.runForPerson(await people.get(KIT), new Date('2026-11-17T14:35:00Z'));
  assert.equal(sent.length, 1, 'not twice for the same meeting');
});

test('switched off means nothing is sent', async () => {
  sent.length = 0;
  await people.update(KIT, { prefs: { morning: false, prep: false }, lastMorningDate: null, prepped: {} });
  const now = new Date('2026-11-18T14:30:00Z');
  calendar = { timeZone: 'UTC', events: [{ id: 'e2', title: 'Kenect again', start: soon(now, 20), isAllDay: false, declined: false, attendees: [KIT, 'wendy@kenect.com'] }] };
  await coworker.runForPerson(await people.get(KIT), new Date('2026-11-18T08:00:00Z'));
  await coworker.runForPerson(await people.get(KIT), now);
  assert.equal(sent.length, 0);
  await people.update(KIT, { prefs: {} });
});

test('revoked Google access stops the person\'s messages until they reconnect', async () => {
  calendarError = new Error('invalid_grant');
  await coworker.runForPerson(await people.get(KIT), new Date('2026-11-19T08:00:00Z'));
  calendarError = null;
  assert.equal((await people.get(KIT)).google.broken, true);
  assert.equal(people.googleTokens(await people.get(KIT)), null);
  await people.saveGoogle(KIT, { refresh_token: 'r', scope: 'openid' }, 'Kit Alimasi');
});

// ---- Clients and recap drafts through the API ----

let server, base;

test.before(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const email = req.headers['x-test-user'];
    const scope = req.headers['x-test-scope'] || '';
    req.appSession = email ? { user: { email, name: email.split('@')[0] }, googleTokens: { refresh_token: 'r', scope } } : {};
    next();
  });
  app.use('/api', require('../routes/api'));
  await new Promise(resolve => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => server && server.close());

const call = (user, method, url, headers = {}) => fetch(`${base}${url}`, { method, headers: { 'x-test-user': user, ...headers } })
  .then(async r => ({ status: r.status, body: await r.json() }));

test('the Clients page only uses meetings the person attended', async () => {
  const list = await call(KIT, 'GET', '/api/clients');
  assert.deepEqual(list.body.data.map(c => `${c.key}:${c.meetings}`), ['kenect.com:1']);
  const detail = await call(KIT, 'GET', '/api/clients/kenect.com');
  assert.deepEqual(detail.body.data.meetings.map(m => m.id), ['k1']);
  assert.doesNotMatch(JSON.stringify(detail.body), /SECRET/);
  assert.equal((await call('nobody@zawadie.com', 'GET', '/api/clients/kenect.com')).status, 404);
});

test('recap drafts: only for attendees, and only once Gmail drafts are allowed', async () => {
  assert.equal((await call(KIT, 'POST', '/api/meetings/k2/recap-draft', { 'x-test-scope': 'gmail.compose' })).status, 403, 'not their meeting');
  const noGmail = await call(KIT, 'POST', '/api/meetings/k1/recap-draft');
  assert.equal(noGmail.status, 409);
  assert.equal(noGmail.body.needsGmail, true);
});

test('co-worker settings belong to the signed-in person', async () => {
  const res = await fetch(`${base}/api/me/coworker`, { method: 'PUT', headers: { 'x-test-user': TYLER, 'Content-Type': 'application/json' }, body: JSON.stringify({ morning: false }) }).then(r => r.json());
  assert.equal(res.data.prefs.morning, false);
  assert.notEqual((await people.get(KIT)).prefs.morning, false, 'Kit\'s setting untouched');
  assert.equal((await call(TYLER, 'GET', '/api/me/coworker')).body.data.google, null, 'Tyler never connected Google');
});
