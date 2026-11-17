// My Work privacy: each person only ever reaches their own work.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const storeFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ombeni-work-')), 'work-store.json');
process.env.OMBENI_WORK_STORE_FILE = storeFile;
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test';
process.env.MONDAY_API_KEY = 'test-key';
delete process.env.STATEMENTS_FROM;

const express = require('express');
const store = require('../data/store');
const workStore = require('../data/workStore');
const mondayService = require('../services/mondayService');
const openaiService = require('../services/openaiService');
const { isEligibleMeeting, shouldRetry } = require('../services/statementService');

const KIT = 'kit@zawadie.com';
const ASTRID = 'astrid@zawadie.com';
const TYLER = 'tyler@zawadie.com';

const meetings = [
  { id: 'm1', title: 'Kenect sync', date: '2026-11-04', source: 'notetaker', participants: [KIT, ASTRID, 'wendy@kenect.com'] },
  { id: 'm2', title: 'Leadership', date: '2026-11-05', source: 'notetaker', participants: [TYLER] },
  { id: 'm3', title: 'No attendee list', date: '2026-11-05', source: 'notetaker', participants: [] }
];
store.getMeetings = () => meetings;
store.getMeeting = (id) => meetings.find(m => m.id === id);

// Monday stand-ins: Kit is a member of board 1 only.
const created = [];
mondayService.listBoardsFor = async (email) => (email === KIT ? [{ id: '1', name: 'Kit board', workspace: null }] : []);
mondayService.createTask = async (args) => { created.push(args); return { created: true, itemId: '999' }; };
mondayService.addUpdate = async () => ({ id: 'u1' });
openaiService.askAboutAssignment = async () => 'From the meeting: two pages.';
const checkService = require('../services/checkService');
const checkedWork = [];
checkService.checkExplanation = async (a, text) => ({ items: [], extra: [], ready: /everything/.test(text) });
checkService.checkWork = async (a, text) => { checkedWork.push(text); return { items: [], ready: true, truncated: false }; };

const statement = { outcome: 'x', mustHaves: [], avoid: [], due: null, dueSaid: null, deliverTo: null, unclear: [] };
let kitTask, tylerTask, unassignedM1, unassignedM2;
let server, base;

test.before(async () => {
  kitTask = await workStore.saveAssignment({ meetingId: 'm1', meetingTitle: 'Kenect sync', meetingDate: '2026-11-04', ownerEmail: KIT, title: 'Kit task', statement, status: 'new', declinedBy: [] });
  tylerTask = await workStore.saveAssignment({ meetingId: 'm2', meetingTitle: 'Leadership', meetingDate: '2026-11-05', ownerEmail: TYLER, title: 'Tyler task', statement, status: 'new', declinedBy: [] });
  unassignedM1 = await workStore.saveAssignment({ meetingId: 'm1', meetingTitle: 'Kenect sync', ownerEmail: null, ownerName: 'BAM team', title: 'Team task', statement, status: 'new', declinedBy: [] });
  unassignedM2 = await workStore.saveAssignment({ meetingId: 'm2', meetingTitle: 'Leadership', ownerEmail: null, title: 'Leadership open task', statement, status: 'new', declinedBy: [] });
  await workStore.saveBrief({ meetingId: 'm1', status: 'done', externalDomains: ['kenect.com'], waitingOnClient: [{ who: 'Wendy', what: 'Send logo' }] });
  await workStore.saveBrief({ meetingId: 'm2', status: 'done', externalDomains: [], waitingOnClient: [{ who: 'x', what: 'secret leadership item' }] });

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const email = req.headers['x-test-user'];
    req.appSession = email ? { user: { email, name: email.split('@')[0] } } : {};
    next();
  });
  app.use('/work', require('../routes/work'));
  await new Promise(resolve => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => server.close());

const call = (user, method, url, body) => fetch(`${base}${url}`, {
  method,
  headers: { 'Content-Type': 'application/json', ...(user ? { 'x-test-user': user } : {}) },
  body: body ? JSON.stringify(body) : undefined
}).then(async r => ({ status: r.status, body: await r.json() }));

test('signed-out requests get nothing', async () => {
  assert.equal((await call(null, 'GET', '/work')).status, 401);
});

test('a person sees only their own work and their own meetings', async () => {
  const { body } = await call(KIT, 'GET', '/work');
  assert.deepEqual(body.data.mine.map(a => a.title), ['Kit task']);
  assert.deepEqual(body.data.unassigned.map(a => a.title), ['Team task']);
  assert.deepEqual(body.data.waitingOnClient.map(w => w.meetingId), ['m1']);
  assert.doesNotMatch(JSON.stringify(body), /Tyler task|Leadership open task|secret leadership item/);
});

test('nobody can act on someone else\'s assignment', async () => {
  for (const [method, url, body] of [
    ['POST', `/work/${tylerTask.id}/respond`, { response: 'got_it' }],
    ['POST', `/work/${tylerTask.id}/ask`, { messages: [{ role: 'user', content: 'hi' }] }],
    ['POST', `/work/${tylerTask.id}/monday`, { boardId: '1' }]
  ]) {
    assert.equal((await call(KIT, method, url, body)).status, 404, url);
  }
  assert.equal((await workStore.getAssignment(tylerTask.id)).status, 'new');
});

test('only that meeting\'s attendees can take unassigned work', async () => {
  assert.equal((await call(KIT, 'POST', `/work/${unassignedM2.id}/claim`)).status, 404);
  const res = await call(ASTRID, 'POST', `/work/${unassignedM1.id}/claim`);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.ownerEmail, ASTRID);
  assert.equal((await call(KIT, 'POST', `/work/${unassignedM1.id}/claim`)).status, 409);
});

test('"Not mine" hands the work back to the meeting\'s attendees', async () => {
  const res = await call(KIT, 'POST', `/work/${kitTask.id}/respond`, { response: 'not_mine' });
  assert.equal(res.status, 200);
  const back = await workStore.getAssignment(kitTask.id);
  assert.equal(back.ownerEmail, null);
  assert.deepEqual(back.declinedBy, [KIT]);
  assert.ok((await call(ASTRID, 'GET', '/work')).body.data.unassigned.some(a => a.id === kitTask.id));
  // Kit changes their mind and takes it back.
  assert.equal((await call(KIT, 'POST', `/work/${kitTask.id}/claim`)).status, 200);
});

test('work goes to Monday only on the person\'s own board, and only once', async () => {
  assert.equal((await call(KIT, 'POST', `/work/${kitTask.id}/monday`, { boardId: '2' })).status, 400);
  const res = await call(KIT, 'POST', `/work/${kitTask.id}/monday`, { boardId: '1' });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.monday.boardName, 'Kit board');
  assert.equal(created.length, 1);
  assert.equal(created[0].ownerEmail, KIT);
  assert.equal((await call(KIT, 'POST', `/work/${kitTask.id}/monday`, { boardId: '1' })).status, 409);
  assert.equal(created.length, 1);
});

test('got it, done and reopen move the status', async () => {
  for (const [response, status] of [['got_it', 'confirmed'], ['done', 'done'], ['reopen', 'confirmed']]) {
    const res = await call(KIT, 'POST', `/work/${kitTask.id}/respond`, { response });
    assert.equal(res.body.data.status, status);
  }
  assert.equal((await call(KIT, 'POST', `/work/${kitTask.id}/respond`, { response: 'delete' })).status, 400);
});

test('explaining back: only the owner, and a clean explanation counts as "Got it"', async () => {
  const fresh = await workStore.saveAssignment({ meetingId: 'm1', meetingTitle: 'Kenect sync', ownerEmail: KIT, title: 'Explain me', statement, status: 'new', declinedBy: [] });
  assert.equal((await call(ASTRID, 'POST', `/work/${fresh.id}/explain`, { text: 'I will do everything that was asked.' })).status, 404);
  assert.equal((await call(KIT, 'POST', `/work/${fresh.id}/explain`, { text: 'short' })).status, 400);

  let res = await call(KIT, 'POST', `/work/${fresh.id}/explain`, { text: 'I will do part of it, roughly.' });
  assert.equal(res.body.data.status, 'new', 'gaps found: not confirmed yet');
  assert.equal(res.body.data.explained.text, 'I will do part of it, roughly.');

  res = await call(KIT, 'POST', `/work/${fresh.id}/explain`, { text: 'I will do everything that was asked.' });
  assert.equal(res.body.data.status, 'confirmed');
});

test('checking work: pasted text or an uploaded file, owner only, last 5 results kept, work not stored', async () => {
  const a = await workStore.saveAssignment({ meetingId: 'm1', meetingTitle: 'Kenect sync', ownerEmail: KIT, title: 'Check me', statement, status: 'confirmed', declinedBy: [] });
  assert.equal((await call(ASTRID, 'POST', `/work/${a.id}/check`, { text: 'my draft' })).status, 404);
  assert.equal((await call(KIT, 'POST', `/work/${a.id}/check`, { text: '' })).status, 400);

  const form = new FormData();
  form.append('file', new Blob(['SECRET DRAFT CONTENTS from a file']), 'draft.txt');
  const up = await fetch(`${base}/work/${a.id}/check`, { method: 'POST', headers: { 'x-test-user': KIT }, body: form }).then(r => r.json());
  assert.equal(up.data.checks[0].source, 'draft.txt');
  assert.equal(checkedWork.at(-1), 'SECRET DRAFT CONTENTS from a file');

  const bad = new FormData();
  bad.append('file', new Blob(['x']), 'draft.exe');
  assert.equal((await fetch(`${base}/work/${a.id}/check`, { method: 'POST', headers: { 'x-test-user': KIT }, body: bad })).status, 400);

  for (let i = 0; i < 6; i++) await call(KIT, 'POST', `/work/${a.id}/check`, { text: `draft ${i}` });
  const saved = await workStore.getAssignment(a.id);
  assert.equal(saved.checks.length, 5);
  assert.equal(saved.checks[0].source, 'What you wrote');
  assert.doesNotMatch(JSON.stringify(saved), /SECRET DRAFT CONTENTS|draft 5/);
});

test('handing work back clears the explanation and checks, so the next person never sees them', async () => {
  const a = await workStore.saveAssignment({
    meetingId: 'm1', meetingTitle: 'Kenect sync', ownerEmail: KIT, title: 'Hand me back', statement, status: 'confirmed', declinedBy: [],
    explained: { text: 'my private words', result: { items: [], extra: [], ready: true } },
    checks: [{ source: 'mine.docx', result: { items: [], ready: true } }]
  });
  await call(KIT, 'POST', `/work/${a.id}/respond`, { response: 'not_mine' });
  const claimed = await call(ASTRID, 'POST', `/work/${a.id}/claim`);
  assert.equal(claimed.body.data.explained, null);
  assert.deepEqual(claimed.body.data.checks, []);
  assert.doesNotMatch(JSON.stringify(claimed.body), /my private words|mine\.docx/);
});

test('a recording with no attendee list is visible to nobody; demo meetings stay open', () => {
  assert.equal(store.isAuthorizedForMeeting(meetings[2], KIT), false);
  assert.equal(store.isAuthorizedForMeeting({ source: 'demo', participants: [] }, null), true);
  assert.equal(store.isAuthorizedForMeeting(meetings[0], KIT), true);
  assert.equal(store.isAuthorizedForMeeting(meetings[0], TYLER), false);
});

test('statements are only written for recent, recorded meetings with Zawadie people', () => {
  const today = new Date().toISOString().slice(0, 10);
  const old = new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10);
  const meeting = { source: 'notetaker', date: today, participants: [KIT], transcriptEntries: [{ speaker: 'Kit', at: 0, text: 'hi' }] };
  assert.equal(isEligibleMeeting(meeting, today), true);
  assert.equal(isEligibleMeeting({ ...meeting, date: old }, old), false, 'too old to be news');
  assert.equal(isEligibleMeeting(meeting, '2099-01-01'), false, 'before the start date');
  assert.equal(isEligibleMeeting({ ...meeting, transcriptEntries: [] }, today), false);
  assert.equal(isEligibleMeeting({ ...meeting, participants: ['wendy@kenect.com'] }, today), false);
  assert.equal(isEligibleMeeting({ ...meeting, source: 'demo' }, today), false);
});

test('a failed meeting is retried hourly for about a day, a finished one never', () => {
  const hourAgo = new Date(Date.now() - 61 * 60 * 1000).toISOString();
  const justNow = new Date().toISOString();
  assert.equal(shouldRetry({ status: 'failed', attempts: 1, updatedAt: hourAgo }), true);
  assert.equal(shouldRetry({ status: 'failed', attempts: 1, updatedAt: justNow }), false);
  assert.equal(shouldRetry({ status: 'failed', attempts: 24, updatedAt: hourAgo }), false);
  assert.equal(shouldRetry({ status: 'done', attempts: 1, updatedAt: hourAgo }), false);
});
