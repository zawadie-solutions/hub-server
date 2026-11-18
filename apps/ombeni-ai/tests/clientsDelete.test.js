// Deleting a client from your Clients list: gone from your list for good (no
// undo), only for you, and only a new meeting with them brings them back.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ombeni-clients-'));
process.env.OMBENI_WORK_STORE_FILE = path.join(dir, 'work.json');
process.env.OMBENI_PEOPLE_FILE = path.join(dir, 'people.json');
process.env.TOKEN_KEY = 'test-token-key';

const express = require('express');
const store = require('../data/store');
const { isDeleted, withoutDeleted } = require('../services/clients');

const KIT = 'kit@zawadie.com';
const TYLER = 'tyler@zawadie.com';
const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

// Kit's clients, as on the Clients page.
const meetings = [
  { id: 'm1', title: 'Tidey Ocean weekly', date: '2026-11-03', kind: 'client', participants: [KIT, 'anna@tideyocean.org'] },
  { id: 'm2', title: 'Ted catch-up', date: '2026-11-03', kind: 'client', participants: [KIT, 'tedtyree@gmail.com'] },
  { id: 'm3', title: 'Fathom Sync', date: '2026-09-18', kind: 'client', participants: [KIT, 'matt@fathom.video'] },
  { id: 'm4', title: 'Nanoshield intro', date: '2026-09-03', kind: 'client', participants: [KIT, 'bo@nanoshieldutah.com'] },
  { id: 'm5', title: 'Fathom with Tyler', date: '2026-09-20', kind: 'client', participants: [TYLER, 'matt@fathom.video'] },
  { id: 'm6', title: 'Tyler only', date: '2026-10-01', kind: 'client', participants: [TYLER, 'x@acme.com'] }
];
store.getMeetings = () => meetings;
store.getMeeting = (id) => meetings.find(m => m.id === id);

let server, base;
test.before(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const email = req.headers['x-test-user'];
    req.appSession = email ? { user: { email } } : {};
    next();
  });
  app.use('/api/clients', require('../routes/clients'));
  await new Promise(resolve => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server && server.close());

const call = (user, method, url) => fetch(`${base}${url}`, { method, headers: user ? { 'x-test-user': user } : {} })
  .then(async r => ({ status: r.status, body: await r.json().catch(() => null) }));
const keys = (body) => body.data.map(c => c.key);

test('deleting a client takes it off your list for good', async () => {
  const res = await call(KIT, 'DELETE', '/api/clients/fathom.video');
  assert.equal(res.status, 200);
  assert.deepEqual(keys(res.body), ['tideyocean.org', 'tedtyree@gmail.com', 'nanoshieldutah.com']);
  assert.equal(res.body.removed, undefined, 'no list of deleted clients to restore from');

  assert.deepEqual(keys((await call(KIT, 'GET', '/api/clients')).body), ['tideyocean.org', 'tedtyree@gmail.com', 'nanoshieldutah.com'], 'still gone on the next visit');
  assert.equal((await call(KIT, 'GET', '/api/clients/fathom.video')).status, 404, 'its page is gone too');
  assert.equal((await call(KIT, 'POST', '/api/clients/fathom.video/summary')).status, 404);
  assert.equal((await call(KIT, 'POST', '/api/clients/fathom.video/restore')).status, 404, 'no undo');
  assert.equal((await call(KIT, 'DELETE', '/api/clients/fathom.video')).status, 404, 'already deleted');
});

test('only your list changes: the meetings stay, and colleagues keep the client', async () => {
  assert.ok(meetings.some(m => m.id === 'm3'), 'the meeting recording is still there');
  assert.ok(keys((await call(TYLER, 'GET', '/api/clients')).body).includes('fathom.video'), 'Tyler still has Fathom');
  assert.deepEqual((await call(TYLER, 'GET', '/api/clients/fathom.video')).body.data.meetings.map(m => m.id), ['m5']);
});

test('only a client in your own list can be deleted, and only when signed in', async () => {
  assert.equal((await call(KIT, 'DELETE', '/api/clients/acme.com')).status, 404, 'Tyler\'s client, not Kit\'s');
  assert.equal((await call(null, 'DELETE', '/api/clients/nanoshieldutah.com')).status, 401);
});

test('a deleted client shows up again only after a new meeting with them', async () => {
  meetings.push({ id: 'm7', title: 'Fathom again', date: tomorrow, kind: 'client', participants: [KIT, 'matt@fathom.video'] });
  try {
    const res = await call(KIT, 'GET', '/api/clients');
    assert.equal(keys(res.body)[0], 'fathom.video');
    assert.equal((await call(KIT, 'GET', '/api/clients/fathom.video')).status, 200);
  } finally {
    meetings.pop();
  }
});

test('deleted means no meeting after the day it was deleted', () => {
  const list = [{ key: 'a.com', lastDate: '2026-11-18' }, { key: 'b.com', lastDate: '2026-11-19' }, { key: 'c.com', lastDate: '2026-11-01' }];
  const deleted = { 'a.com': '2026-11-18', 'b.com': '2026-11-18' };
  assert.equal(isDeleted(list[0], deleted), true, 'last met the day it was deleted');
  assert.equal(isDeleted(list[1], deleted), false, 'met again the next day');
  assert.deepEqual(withoutDeleted(list, deleted).map(c => c.key), ['b.com', 'c.com']);
  assert.equal(withoutDeleted(list, undefined).length, 3);
});
