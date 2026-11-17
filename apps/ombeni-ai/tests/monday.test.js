// Connect Monday: sign-in (both Monday methods), only your own account,
// encrypted storage, renewal, and tasks only on a board you named.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ombeni-monday-'));
process.env.OMBENI_PEOPLE_FILE = path.join(dir, 'people.json');
process.env.TOKEN_KEY = 'test-token-key';
process.env.MONDAY_CLIENT_ID = 'client-123';
process.env.MONDAY_CLIENT_SECRET = 'secret-456';
process.env.APP_URL = 'https://ai.zawadie.com/ombeni-ai/';

const express = require('express');
const people = require('../data/people');
const mondayAuth = require('../services/mondayAuth');
const mondayService = require('../services/mondayService');
const myMonday = require('../services/myMonday');

const KIT = 'kit@zawadie.com';

// Monday's servers, stubbed: records each call and answers like Monday.
const calls = [];
let meEmail = KIT;
let refreshResult = null;
const jwt = (expSeconds) => `h.${Buffer.from(JSON.stringify({ exp: expSeconds })).toString('base64url')}.s`;
const realFetch = global.fetch;
global.fetch = async (url, init = {}) => {
  if (String(url).startsWith('http://127.0.0.1')) return realFetch(url, init);
  const body = init.body ? JSON.parse(init.body) : {};
  calls.push({ url: String(url), body });
  const json = (data, status = 200) => ({ ok: status < 300, status, json: async () => data });
  if (url === 'https://auth.monday.com/oauth_ms/oauth/token' && body.grant_type === 'refresh_token') {
    return refreshResult || json({ access_token: jwt(Math.floor(Date.now() / 1000) + 3600), refresh_token: 'refresh-2', token_type: 'Bearer' });
  }
  if (String(url).includes('/token')) {
    return json({ access_token: String(url).includes('oauth_ms') ? jwt(Math.floor(Date.now() / 1000) + 120) : 'legacy-token', refresh_token: String(url).includes('oauth_ms') ? 'refresh-1' : undefined, token_type: 'Bearer' });
  }
  if (String(url).includes('/revoke')) return json({ success: true });
  if (url === 'https://api.monday.com/v2') return json({ data: { me: { id: '777', name: 'Kit Alimasi', email: meEmail, account: { id: '1', slug: 'zawadie' } } } });
  throw new Error(`unexpected fetch ${url}`);
};

test('the sign-in link goes to Monday with PKCE (S256), a state, and the exact redirect address', () => {
  const pending = mondayAuth.startSignIn();
  const url = new URL(mondayAuth.authorizeUrl(pending));
  assert.equal(url.origin + url.pathname, 'https://auth.monday.com/oauth2/authorize');
  assert.equal(url.searchParams.get('client_id'), 'client-123');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://ai.zawadie.com/ombeni-ai/auth/monday/callback');
  assert.equal(url.searchParams.get('state'), pending.state);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('code_challenge'), crypto.createHash('sha256').update(pending.verifier).digest('base64url'));
});

// The real routes, with a signed-in person in the session.
let server, base, session;
test.before(async () => {
  const app = express();
  app.use((req, res, next) => { req.appSession = session; next(); });
  app.use('/auth', require('../routes/auth'));
  await new Promise(r => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.close(); global.fetch = realFetch; });

const get = (p) => realFetch(`${base}${p}`, { redirect: 'manual' });

async function signIn(query) {
  session = { user: { email: KIT, name: 'Kit' } };
  const start = await get('/auth/monday');
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  return get(`/auth/monday/callback?code=abc&state=${state}${query || ''}`);
}

test('a callback that wasn\'t started here is refused', async () => {
  session = { user: { email: KIT }, mondaySignIn: { state: 'real', verifier: 'v', at: Date.now() } };
  const res = await get('/auth/monday/callback?code=abc&state=forged');
  assert.equal(res.status, 400);
  assert.equal((await people.get(KIT)), null);
});

test('newer method: token, then it must be your own Monday account, then stored encrypted', async () => {
  calls.length = 0;
  const res = await signIn('&status=approved');
  assert.equal(res.status, 302);
  assert.match(res.headers.get('location'), /#settings$/);
  const exchange = calls.find(c => c.url.includes('/token'));
  assert.equal(exchange.url, 'https://auth.monday.com/oauth_ms/oauth/token');
  assert.equal(exchange.body.grant_type, 'authorization_code');
  assert.ok(exchange.body.code_verifier);

  const person = await people.get(KIT);
  assert.equal(person.monday.flow, 'new');
  assert.equal(person.monday.userId, '777');
  assert.doesNotMatch(fs.readFileSync(process.env.OMBENI_PEOPLE_FILE, 'utf8'), /refresh-1/);
});

test('older method (no status from Monday): the older token address, tokens that don\'t expire', async () => {
  calls.length = 0;
  await signIn('');
  assert.equal(calls.find(c => c.url.includes('/token')).url, 'https://auth.monday.com/oauth2/token');
  const person = await people.get(KIT);
  assert.equal(person.monday.flow, 'legacy');
  assert.equal(person.monday.expiresAt, null);
  assert.equal(await mondayAuth.tokenFor(KIT), 'legacy-token');
});

test('someone else\'s Monday account is refused and nothing is stored', async () => {
  await people.update(KIT, { monday: null });
  meEmail = 'tyler@zawadie.com';
  const res = await signIn('&status=approved');
  meEmail = KIT;
  assert.equal(res.status, 400);
  assert.match(await res.text(), /connect that same Monday account/);
  assert.equal((await people.get(KIT)).monday, null);
  assert.ok(calls.some(c => c.url.includes('/revoke')), 'the unwanted access is cancelled at Monday');
});

test('access about to expire is renewed once, and the new refresh token replaces the old', async () => {
  await signIn('&status=approved'); // expires in 2 minutes
  calls.length = 0;
  const [a, b] = await Promise.all([mondayAuth.tokenFor(KIT), mondayAuth.tokenFor(KIT)]);
  assert.equal(a, b);
  assert.equal(calls.filter(c => c.body.grant_type === 'refresh_token').length, 1, 'one renewal for two requests');
  assert.equal(calls[0].body.refresh_token, 'refresh-1');
  calls.length = 0;
  await mondayAuth.tokenFor(KIT);
  assert.equal(calls.length, 0, 'fresh for an hour now');
});

test('a cancelled connection stops being used until you reconnect', async () => {
  await signIn('&status=approved');
  refreshResult = { ok: false, status: 400, json: async () => ({ error: 'invalid_grant' }) };
  assert.equal(await mondayAuth.tokenFor(KIT), null);
  refreshResult = null;
  assert.equal((await people.get(KIT)).monday.broken, true);
});

test('Ask Ombeni only creates tasks on a board you named, as you', async () => {
  mondayAuth.tokenFor = async (email) => (email === KIT ? 'kit-token' : null);
  mondayService.listMyBoards = async () => [{ id: '1', name: 'Client Work' }, { id: '2', name: 'Client Work Archive' }, { id: '3', name: 'Personal' }];
  const created = [];
  mondayService.createTask = async (args) => { created.push(args); return { created: true, itemId: '9' }; };
  await people.update(KIT, { monday: { userId: '777' } });

  assert.deepEqual((await myMonday.createMyTask(KIT, { task: 'x' })).boards, ['Client Work', 'Client Work Archive', 'Personal'], 'no board named: ask');
  assert.ok((await myMonday.createMyTask(KIT, { task: 'x', board: 'Work' })).boards, 'two boards match: ask');
  assert.ok((await myMonday.createMyTask(KIT, { task: 'x', board: 'Shared board' })).boards, 'not one of theirs: ask');
  assert.equal(created.length, 0);

  const ok = await myMonday.createMyTask(KIT, { task: 'Follow up', board: 'client work' });
  assert.deepEqual(ok, { created: true, boardName: 'Client Work' });
  assert.equal(created[0].token, 'kit-token');
  assert.equal(created[0].boardId, '1');
  assert.equal(created[0].ownerUserId, '777');

  assert.equal((await myMonday.createMyTask('tyler@zawadie.com', { task: 'x', board: 'Personal' })).error, 'their Monday account isn\'t connected');
});
