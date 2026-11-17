// Slack buttons and thread replies: signatures, ownership, and what each kind
// of reply does. Slack itself, OpenAI and file downloads are stubbed.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ombeni-slack-'));
process.env.OMBENI_WORK_STORE_FILE = path.join(dir, 'work.json');
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test';
process.env.SLACK_BOT_TOKEN = 'xoxb-test';
process.env.SLACK_SIGNING_SECRET = 'signing-secret';

const express = require('express');
const workStore = require('../data/workStore');
const store = require('../data/store');
const slackService = require('../services/slackService');
const checkService = require('../services/checkService');
const openaiService = require('../services/openaiService');
const slackHooks = require('../services/slackHooks');
const { slackMessage } = require('../services/statements');
const { cleanSlackText } = require('../services/slackReplies');

const KIT = 'kit@zawadie.com';
const users = { UKIT: KIT, UTYLER: 'tyler@zawadie.com' };

const posted = [];
slackService.postMessage = async (channel, threadTs, message) => { posted.push({ channel, threadTs, text: JSON.stringify(message) }); return true; };
slackService.emailOfUser = async (id) => users[id] || null;
slackService.downloadFile = async () => Buffer.from('My draft: one page, Google Doc, Workspace access within 2 days.');
const calls = { explain: [], work: [], ask: [] };
checkService.checkExplanation = async (a, text) => { calls.explain.push(text); return { items: [], extra: [], ready: /everything/.test(text) }; };
checkService.checkWork = async (a, text) => { calls.work.push(text); return { items: [{ id: 'R1', kind: 'must', text: 'One page', status: 'not_met', evidence: '', fix: 'Cut it to one page.' }], ready: false, truncated: false }; };
openaiService.askAboutAssignment = async (a, m, messages) => { calls.ask.push(messages[0].content); return 'Tyler said: "keep it to one page" (12:41).'; };
store.getMeeting = () => null;

const statement = { outcome: 'x', mustHaves: [], avoid: [], due: null, dueSaid: null, deliverTo: null, unclear: [] };
let assignment;
const THREAD = { channel: 'DKIT', ts: '1731859200.000100' };

test.before(async () => {
  assignment = await workStore.saveAssignment({ meetingId: 'm1', meetingTitle: 'Kenect sync', ownerEmail: KIT, title: 'Checklist', statement, status: 'new', declinedBy: [] });
  // What notifyOwner records when the DM is sent.
  await workStore.setSetting(`slack:${THREAD.channel}:${THREAD.ts}`, assignment.id);
});

const sign = (raw, ts = Math.floor(Date.now() / 1000), secret = 'signing-secret') => ({
  'x-slack-request-timestamp': String(ts),
  'x-slack-signature': `v0=${crypto.createHmac('sha256', secret).update(`v0:${ts}:${raw}`).digest('hex')}`
});

test('only requests signed by Slack, and recent ones, are accepted', () => {
  const raw = Buffer.from('{"a":1}');
  assert.equal(slackHooks.verify(raw, sign(raw)), true);
  assert.equal(slackHooks.verify(raw, sign(raw, undefined, 'wrong-secret')), false);
  assert.equal(slackHooks.verify(raw, sign(raw, Math.floor(Date.now() / 1000) - 600)), false, 'replayed 10 minutes later');
  assert.equal(slackHooks.verify(Buffer.from('{"a":2}'), sign(raw)), false, 'body changed');
  assert.equal(slackHooks.verify(raw, {}), false);
  assert.equal(slackHooks.verify(raw, sign(raw), ''), false, 'no secret configured: nothing accepted');
});

test('a refused call says which setting is wrong', () => {
  const raw = Buffer.from('{}');
  assert.equal(slackHooks.check(raw, sign(raw)), 'ok');
  assert.equal(slackHooks.check(raw, sign(raw), ''), 'no_secret');
  assert.equal(slackHooks.check('{}', sign(raw)), 'no_body', 'body already parsed by something else');
  assert.equal(slackHooks.check(raw, sign(raw, Math.floor(Date.now() / 1000) - 600)), 'stale');
  assert.equal(slackHooks.check(raw, sign(raw, undefined, 'other')), 'mismatch');
});

test('settings pasted with stray spaces or line breaks still work', () => {
  process.env.SLACK_SIGNING_SECRET = '  signing-secret\n';
  delete require.cache[require.resolve('../config/env')];
  assert.equal(require('../config/env').SLACK_SIGNING_SECRET, 'signing-secret');
  process.env.SLACK_SIGNING_SECRET = 'signing-secret';
});

// The same route the hub mounts: raw body in, then the hook.
let server, base;
test.before(async () => {
  const app = express();
  app.post('/hooks/:hook', express.raw({ type: '*/*' }), (req, res) => ({ 'slack-events': slackHooks.events, 'slack-interactions': slackHooks.interactions })[req.params.hook](req, res));
  await new Promise(r => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

const send = (hook, raw, contentType = 'application/json', headers = sign(raw)) =>
  fetch(`${base}/hooks/${hook}`, { method: 'POST', headers: { 'Content-Type': contentType, ...headers }, body: raw });
const settle = () => new Promise(r => setTimeout(r, 50));

test('Slack\'s URL check gets its challenge back; unsigned calls are refused', async () => {
  const raw = JSON.stringify({ type: 'url_verification', challenge: 'abc123' });
  assert.deepEqual(await (await send('slack-events', raw)).json(), { challenge: 'abc123' });
  assert.equal((await send('slack-events', raw, 'application/json', {})).status, 401);
});

const reply = (o) => ({ type: 'message', channel_type: 'im', channel: THREAD.channel, thread_ts: THREAD.ts, ts: `${Date.now()}.1`, user: 'UKIT', text: '', ...o });
const event = (e, id = crypto.randomUUID()) => JSON.stringify({ type: 'event_callback', event_id: id, event: e });

test('the owner\'s explanation in the thread is checked, and a clean one counts as Got it', async () => {
  posted.length = 0;
  await send('slack-events', event(reply({ text: 'I will do part of it' })));
  await settle();
  assert.match(posted.at(-1).text, /thing\(s\) to look at before you start/);
  assert.equal(posted.at(-1).threadTs, THREAD.ts, 'answered in the same thread');
  assert.equal((await workStore.getAssignment(assignment.id)).status, 'new');

  await send('slack-events', event(reply({ text: 'I will do everything that was asked, by Friday, for Tyler.' })));
  await settle();
  assert.match(posted.at(-1).text, /You've got it.*marked this as \*Got it\*/);
  assert.equal((await workStore.getAssignment(assignment.id)).status, 'confirmed');
});

test('a retried event is handled once', async () => {
  const before = calls.explain.length;
  const body = event(reply({ text: 'I will deliver the checklist to Tyler.' }), 'Ev-SAME');
  await send('slack-events', body);
  await send('slack-events', body);
  await settle();
  assert.equal(calls.explain.length, before + 1);
});

test('a question is answered from the meeting', async () => {
  await send('slack-events', event(reply({ text: 'What exactly did they say about the format?' })));
  await settle();
  assert.equal(calls.ask.at(-1), 'What exactly did they say about the format?');
  assert.match(posted.at(-1).text, /keep it to one page/);
});

test('an attached draft is checked; unsupported files are explained', async () => {
  await send('slack-events', event(reply({ subtype: 'file_share', files: [{ name: 'draft.txt', size: 100, url_private_download: 'https://files.slack.com/x' }] })));
  await settle();
  assert.match(calls.work.at(-1), /My draft: one page/);
  assert.match(posted.at(-1).text, /requirement\(s\) to fix.*draft\.txt.*Cut it to one page/);
  assert.equal((await workStore.getAssignment(assignment.id)).checks[0].source, 'draft.txt');

  await send('slack-events', event(reply({ subtype: 'file_share', files: [{ name: 'photo.png', size: 100 }] })));
  await settle();
  assert.match(posted.at(-1).text, /I can check \.txt/);
});

test('someone else replying in the thread can\'t act on it or see anything', async () => {
  const before = { ...calls, explain: calls.explain.length, ask: calls.ask.length };
  await send('slack-events', event(reply({ user: 'UTYLER', text: 'I will do everything that was asked.' })));
  await send('slack-events', event(reply({ user: 'UTYLER', text: 'What did they say?' })));
  await settle();
  assert.equal(calls.explain.length, before.explain);
  assert.equal(calls.ask.length, before.ask);
  assert.match(posted.at(-1).text, /isn't yours anymore/);
});

test('bot messages, edits and messages outside a thread', async () => {
  const count = posted.length;
  await send('slack-events', event(reply({ bot_id: 'B1', text: 'from a bot' })));
  await send('slack-events', event(reply({ subtype: 'message_changed', text: 'edited' })));
  await settle();
  assert.equal(posted.length, count, 'ignored');
  await send('slack-events', event(reply({ thread_ts: undefined, text: 'hello?' })));
  await settle();
  assert.match(posted.at(-1).text, /I answer in the thread under each assignment/);
});

test('a message in the main box is about your latest open assignment in that DM, and says so', async () => {
  const older = await workStore.saveAssignment({ meetingId: 'm1', meetingTitle: 'Kenect sync', ownerEmail: KIT, title: 'Older task', statement, status: 'new', declinedBy: [], slack: { status: 'sent', channel: THREAD.channel, ts: '1731850000.000100' } });
  const latest = await workStore.saveAssignment({ meetingId: 'm1', meetingTitle: 'Kenect sync', ownerEmail: KIT, title: 'Latest task', statement, status: 'new', declinedBy: [], slack: { status: 'sent', channel: THREAD.channel, ts: '1731860000.000100' } });
  const before = calls.ask.length;

  await send('slack-events', event(reply({ thread_ts: undefined, text: 'What is the due date for this?' })));
  await settle();
  assert.equal(calls.ask.length, before + 1);
  assert.match(posted.at(-1).text, /About \*Latest task\*, your latest assignment/);
  assert.match(posted.at(-1).text, /keep it to one page/);

  // Someone else's DM channel has nothing of Kit's in it: just the help note.
  await send('slack-events', event(reply({ thread_ts: undefined, channel: 'DOTHER', text: 'hello?' })));
  await settle();
  assert.match(posted.at(-1).text, /I answer in the thread under each assignment/);

  await workStore.deleteAssignment(older.id);
  await workStore.deleteAssignment(latest.id);
});

const click = (actionId, user = 'UKIT', value = assignment.id) => {
  const payload = { type: 'block_actions', user: { id: user }, channel: { id: THREAD.channel }, message: { ts: THREAD.ts }, actions: [{ action_id: actionId, value }] };
  return `payload=${encodeURIComponent(JSON.stringify(payload))}`;
};

test('buttons: only the owner can press them; Got it and Not mine work', async () => {
  await workStore.saveAssignment({ ...(await workStore.getAssignment(assignment.id)), status: 'new' });
  await send('slack-interactions', click('ombeni_got_it', 'UTYLER'), 'application/x-www-form-urlencoded');
  await settle();
  assert.equal((await workStore.getAssignment(assignment.id)).status, 'new');
  assert.match(posted.at(-1).text, /isn't yours anymore/);

  await send('slack-interactions', click('ombeni_got_it'), 'application/x-www-form-urlencoded');
  await settle();
  assert.equal((await workStore.getAssignment(assignment.id)).status, 'confirmed');
  assert.match(posted.at(-1).text, /Marked as Got it/);

  await send('slack-interactions', click('ombeni_not_mine'), 'application/x-www-form-urlencoded');
  await settle();
  const after = await workStore.getAssignment(assignment.id);
  assert.equal(after.ownerEmail, null);
  assert.deepEqual(after.checks, [], 'their checks don\'t pass on');
  assert.match(posted.at(-1).text, /Given back/);

  // After giving it back, their old thread no longer works for them.
  await send('slack-events', event(reply({ text: 'I will do everything that was asked.' })));
  await settle();
  assert.match(posted.at(-1).text, /isn't yours anymore/);
});

test('the DM has working buttons only when Slack can reach Ombeni', () => {
  const a = { id: 'abc', title: 'Checklist', meetingTitle: 'Kenect', meetingDate: '2026-11-04', statement };
  const on = JSON.stringify(slackMessage(a, 'https://x/#work/abc', { interactive: true }).blocks);
  assert.match(on, /"action_id":"ombeni_got_it","value":"abc"/);
  assert.match(on, /"action_id":"ombeni_not_mine".*"confirm"/);
  assert.match(on, /Reply in this thread/);
  const off = JSON.stringify(slackMessage(a, 'https://x/#work/abc').blocks);
  assert.doesNotMatch(off, /ombeni_got_it|Reply in this thread/);
  assert.match(off, /Open in Ombeni/);
});

test('Slack formatting is turned back into what the person typed', () => {
  assert.equal(cleanSlackText('<@U123> Send it to <https://x.com|our site> &amp; Tyler &lt;3'), 'Send it to our site & Tyler <3');
});
