// Gmail drafts end to end, with OpenAI, Google and Slack stubbed: asking
// Ombeni for an email (on the web or in its Slack DM) saves a draft in the
// person's own Gmail, using their stored Google connection; when it can't,
// Ombeni is told exactly why.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ombeni-gmail-'));
process.env.OMBENI_WORK_STORE_FILE = path.join(dir, 'work.json');
process.env.OMBENI_PEOPLE_FILE = path.join(dir, 'people.json');
process.env.TOKEN_KEY = 'test-token-key';
process.env.OPENAI_API_KEY = 'test';
process.env.SLACK_BOT_TOKEN = 'xoxb-test';
process.env.GOOGLE_CLIENT_ID = 'google-client';
process.env.GOOGLE_CLIENT_SECRET = 'google-secret';
process.env.ZAWADIE_SSO_SECRET = 'x'; // an identity source, so the API isn't in open mode

const express = require('express');
const { OpenAI } = require('openai');
const { OAuth2Client } = require('google-auth-library');
const store = require('../data/store');
const people = require('../data/people');
const slackService = require('../services/slackService');
const calendarService = require('../services/calendarService');
const gmailService = require('../services/gmailService');
const slackHooks = require('../services/slackHooks');
const { isDraftRequest } = require('../services/slackReplies');

const KIT = 'kit@zawadie.com';
const COMPOSE = 'openid https://www.googleapis.com/auth/calendar.events.readonly https://www.googleapis.com/auth/gmail.compose';

const meetings = [
  { id: 'k1', title: 'Kenect quarterly', date: '2026-11-04', source: 'notetaker', kind: 'client', participants: [KIT, 'wendy@kenect.com'], analysis: { summary: 'Weekly reports agreed.' } },
  { id: 't1', title: 'Tyler only', date: '2026-11-10', source: 'notetaker', kind: 'client', participants: ['tyler@zawadie.com'], analysis: { summary: 'SECRET' } }
];
store.getMeetings = () => meetings;
store.getMeeting = (id) => meetings.find(m => m.id === id);
store.ensureFreshMeetings = async () => meetings;
store.refreshMeetings = async () => meetings;
calendarService.listEventsForRange = async () => [];

const posted = [];
slackService.postMessage = async (channel, threadTs, message) => { posted.push({ channel, threadTs, text: JSON.stringify(message) }); return true; };
slackService.emailOfUser = async (id) => ({ UKIT: KIT }[id] || null);

// Google: the token refresh (which refresh token was used) and Gmail's drafts endpoint.
const gmail = [];
const refreshedWith = [];
const realGetAccessToken = OAuth2Client.prototype.getAccessToken;
let refreshError = null; // set to make Google's token refresh fail
OAuth2Client.prototype.getAccessToken = async function () {
  refreshedWith.push(this.credentials.refresh_token);
  if (refreshError) throw refreshError;
  return { token: `ya29.${this.credentials.refresh_token}` };
};
let gmailRefusal = null; // set to { status, error } to make Gmail refuse the draft
const realFetch = global.fetch;
global.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.startsWith('http://127.0.0.1')) return realFetch(url, init);
  if (u === 'https://gmail.googleapis.com/gmail/v1/users/me/drafts') {
    gmail.push({ auth: init.headers.Authorization, raw: Buffer.from(JSON.parse(init.body).message.raw, 'base64url').toString('utf8') });
    if (gmailRefusal) return new Response(JSON.stringify({ error: gmailRefusal.error }), { status: gmailRefusal.status, headers: { 'Content-Type': 'application/json' } });
    return new Response(JSON.stringify({ id: 'r-1', message: { id: 'msg-1' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  throw new Error(`unexpected fetch ${u}`);
};

// OpenAI: asks for the draft when the tool is offered, then answers with the tool's result.
const asked = [];
const realCreate = OpenAI.Chat.Completions.prototype.create;
OpenAI.Chat.Completions.prototype.create = async function (req) {
  asked.push(req);
  // The recap-email button asks for JSON.
  if (req.response_format) return { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({ subject: 'Recap', body: 'Hi Wendy' }) } }] };
  const last = req.messages.at(-1);
  if (last.role === 'tool') {
    const result = JSON.parse(last.content);
    return { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: result.success ? `Done.\n[Click here to see the draft](${result.message.match(/https:[^\s)]+/)[0]})` :`Not saved: ${result.message}` } }] };
  }
  if ((req.tools || []).some(t => t.function.name === 'draft_email')) {
    return { choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'draft_email', arguments: JSON.stringify({ to: 'wendy@kenect.com', subject: 'Weekly report', body: 'Hi Wendy,\n\nHere is the plan.\n\nKit' }) } }] } }] };
  }
  return { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'Here is the email text instead.' } }] };
};

let server, base;
test.before(async () => {
  const app = express();
  app.use(express.json());
  // This browser's own sign-in only has the calendar; what's stored is the latest.
  app.use((req, res, next) => {
    const email = req.headers['x-test-user'];
    req.appSession = email ? { user: { email, name: 'Kit' }, googleTokens: { refresh_token: 'old', scope: 'openid' } } : {};
    next();
  });
  app.use('/api', require('../routes/api'));
  await new Promise(resolve => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  server && server.close();
  global.fetch = realFetch;
  OpenAI.Chat.Completions.prototype.create = realCreate;
  OAuth2Client.prototype.getAccessToken = realGetAccessToken;
});

const dm = (text, extra = {}) => ({ type: 'message', channel_type: 'im', user: 'UKIT', channel: 'DKIT', ts: '1731900000.000100', text, ...extra });
const systemPrompt = (req) => req.messages[0].content;

test('the draft tool is offered only with the Gmail permission, and otherwise the reason is given', () => {
  const allowed = gmailService.draftOptions({ refresh_token: 'r', scope: COMPOSE });
  assert.equal(typeof allowed.draftEmail, 'function');
  assert.equal(allowed.draftEmailUnavailable, null);

  const notConnected = gmailService.draftOptions(null);
  assert.equal(notConnected.draftEmail, null);
  assert.match(notConnected.draftEmailUnavailable, /isn't connected/);

  const noPermission = gmailService.draftOptions({ refresh_token: 'r', scope: 'openid' });
  assert.equal(noPermission.draftEmail, null);
  assert.match(noPermission.draftEmailUnavailable, /permission wasn't granted/);
});

test('asking for an email in the Slack DM saves a Gmail draft, as that person, and links to it', async () => {
  await people.saveGoogle(KIT, { refresh_token: 'stored', scope: COMPOSE }, 'Kit');
  asked.length = 0; gmail.length = 0;

  await slackHooks.handleEvent(dm('Create a draft email to <mailto:wendy@kenect.com|wendy@kenect.com> about the weekly report'));

  assert.equal(gmail.length, 1, 'one draft saved in Gmail');
  assert.equal(gmail[0].auth, 'Bearer ya29.stored', 'with Kit\'s own stored Google connection');
  assert.match(gmail[0].raw, /^To: wendy@kenect\.com$/m, 'a recipient given as one address still counts');
  assert.match(gmail[0].raw, /^Subject: Weekly report$/m);
  assert.ok(asked[0].tools.some(t => t.function.name === 'draft_email'), 'the model was offered the draft tool');
  assert.match(systemPrompt(asked[0]), /Kenect quarterly/);
  assert.doesNotMatch(systemPrompt(asked[0]), /SECRET/, 'only meetings Kit attended');

  const reply = posted.at(-1);
  assert.equal(reply.threadTs, dm('').ts, 'answered under their message');
  assert.match(reply.text, /<https:\/\/mail\.google\.com\/mail\/#drafts\?compose=msg-1\|Click here to see the draft>/);
});

test('in Slack without the Gmail permission, nothing goes to Gmail and Ombeni says why', async () => {
  await people.saveGoogle(KIT, { refresh_token: 'stored', scope: 'openid' }, 'Kit');
  asked.length = 0; gmail.length = 0;

  await slackHooks.handleEvent(dm('Can you please draft a follow-up email for the Kenect meeting?'));

  assert.equal(gmail.length, 0);
  assert.equal(asked[0].tools, undefined, 'no draft tool offered');
  assert.match(systemPrompt(asked[0]), /GMAIL DRAFTS ===\nNot available\. Reason: Google is connected, but the Gmail drafts permission wasn't granted/);
  assert.match(posted.at(-1).text, /Here is the email text instead/);
});

test('only an ask for an email is taken as one, not an explanation that mentions an email', () => {
  for (const text of ['Draft an email to Tyler', 'Hi Ombeni, write a recap email for today', 'Could you prepare a reply to Wendy?', 'please create a draft to wendy@kenect.com']) {
    assert.equal(isDraftRequest(text), true, text);
  }
  for (const text of ['I\'ll write the recap email by Friday', 'I will send the weekly report email to Wendy', 'What is the due date?', 'Draft the one-page checklist in Google Docs', 'make sure the email goes out']) {
    assert.equal(isDraftRequest(text), false, text);
  }
});

test('Ask Ombeni on the web uses the stored connection, even when this sign-in has no Gmail permission', async () => {
  await people.saveGoogle(KIT, { refresh_token: 'stored', scope: COMPOSE }, 'Kit');
  asked.length = 0; gmail.length = 0;

  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'x-test-user': KIT, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'Draft an email to Wendy about the weekly report' }] })
  }).then(r => r.json());

  assert.equal(res.success, true);
  assert.equal(gmail.length, 1);
  assert.equal(gmail[0].auth, 'Bearer ya29.stored', 'the stored connection, not this sign-in\'s older one');
  assert.match(res.reply, /\[Click here to see the draft\]\(https:\/\/mail\.google\.com\/mail\/#drafts\?compose=msg-1\)/);
  const toolResult = JSON.parse(asked.at(-1).messages.at(-1).content);
  assert.match(toolResult.message, /exactly as this Markdown, on its own line: \[Click here to see the draft\]\(https:\/\/mail\.google\.com\/mail\/#drafts\?compose=msg-1\)$/, 'Ombeni is told how to show the link');
});

// ---- When Google refuses: the real reason, not "permission restrictions" ----

// Google's own error bodies, as Gmail sends them.
const API_OFF = {
  status: 403,
  error: {
    code: 403,
    message: 'Gmail API has not been used in project 123456 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/gmail.googleapis.com/overview?project=123456 then retry.',
    errors: [{ message: 'Gmail API has not been used...', domain: 'usageLimits', reason: 'accessNotConfigured' }],
    status: 'PERMISSION_DENIED',
    details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'SERVICE_DISABLED', domain: 'googleapis.com', metadata: { service: 'gmail.googleapis.com', consumer: 'projects/123456', activationUrl: 'https://console.developers.google.com/apis/api/gmail.googleapis.com/overview?project=123456' } }]
  }
};
const SCOPE_MISSING = {
  status: 403,
  error: {
    code: 403,
    message: 'Request had insufficient authentication scopes.',
    errors: [{ message: 'Insufficient Permission', domain: 'global', reason: 'insufficientPermissions' }],
    status: 'PERMISSION_DENIED',
    details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT', domain: 'googleapis.com', metadata: { service: 'gmail.googleapis.com' } }]
  }
};

const askWeb = (text) => fetch(`${base}/api/chat`, {
  method: 'POST',
  headers: { 'x-test-user': KIT, 'Content-Type': 'application/json' },
  body: JSON.stringify({ messages: [{ role: 'user', content: text }] })
}).then(r => r.json());

test('Google\'s refusals are told apart by their details, not just the 403', () => {
  assert.deepEqual(gmailService.googleProblem(403, API_OFF.error), { problem: 'gmail_api_off', activationUrl: API_OFF.error.details[0].metadata.activationUrl });
  assert.deepEqual(gmailService.googleProblem(403, SCOPE_MISSING.error), { problem: 'no_gmail_permission' });
  assert.deepEqual(gmailService.googleProblem(401, { message: 'Invalid Credentials' }), { problem: 'reconnect' });
  assert.deepEqual(gmailService.googleProblem(403, { message: 'Delegation denied', status: 'PERMISSION_DENIED' }), { problem: 'other' });
});

test('Gmail API switched off: Ombeni says an admin must turn it on, and the person\'s connection is left alone', async () => {
  await people.saveGoogle(KIT, { refresh_token: 'stored', scope: COMPOSE }, 'Kit');
  gmailRefusal = API_OFF;
  try {
    const res = await askWeb('Draft an email that I can send to Jeremy as he missed yesterday\'s meeting');
    assert.equal(res.success, true);
    assert.match(res.reply, /Not saved: Couldn't save the draft: Google refused because the Gmail API is switched off/);
    assert.match(res.reply, /hub admin needs to enable the Gmail API/);
    assert.match(res.reply, /overview\?project=123456/);
    assert.deepEqual((await people.get(KIT)).google.scopes, COMPOSE.split(' '), 'still allowed: not the person\'s doing');
    const prompt = systemPrompt(asked.at(-1));
    assert.match(prompt, /Never call it a "permission restriction"/);
  } finally {
    gmailRefusal = null;
  }
});

test('Gmail permission missing at Google: Ombeni says to allow it again, and Settings offers the button again', async () => {
  await people.saveGoogle(KIT, { refresh_token: 'stored', scope: COMPOSE }, 'Kit');
  gmailRefusal = SCOPE_MISSING;
  try {
    const res = await askWeb('Draft an email to Wendy about the weekly report');
    assert.match(res.reply, /doesn't have the Gmail permission for this person/);
    assert.match(res.reply, /click Allow Gmail drafts again/);
    const stored = (await people.get(KIT)).google;
    assert.equal(stored.scopes.some(s => /gmail/.test(s)), false, 'Settings shows Allow Gmail drafts again');
    assert.equal(stored.broken, false, 'the calendar connection still works');

    // Next time, Ombeni knows up front and doesn't try.
    asked.length = 0; gmail.length = 0;
    await askWeb('Draft an email to Wendy about the weekly report');
    assert.equal(gmail.length, 0);
    assert.equal(asked[0].tools, undefined);
    assert.match(systemPrompt(asked[0]), /Gmail drafts permission wasn't granted/);
  } finally {
    gmailRefusal = null;
  }
});

test('Google access expired or removed: Ombeni says to reconnect, and the connection shows as broken', async () => {
  await people.saveGoogle(KIT, { refresh_token: 'stored', scope: COMPOSE }, 'Kit');
  refreshError = Object.assign(new Error('invalid_grant'), { response: { data: { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' } } });
  try {
    const result = await gmailService.createDraftFor(KIT, people.googleTokens(await people.get(KIT)), { to: ['wendy@kenect.com'], subject: 's', body: 'b' });
    assert.equal(result.created, false);
    assert.equal(result.problem, 'reconnect');
    assert.match(result.reason, /connect Google again/);
    assert.equal((await people.get(KIT)).google.broken, true);
  } finally {
    refreshError = null;
  }
});

test('the recap-email button shows Google\'s real reason too', async () => {
  await people.saveGoogle(KIT, { refresh_token: 'stored', scope: COMPOSE }, 'Kit');
  gmailRefusal = API_OFF;
  try {
    const res = await fetch(`${base}/api/meetings/k1/recap-draft`, { method: 'POST', headers: { 'x-test-user': KIT } });
    const body = await res.json();
    assert.equal(res.status, 502);
    assert.match(body.error, /Gmail API is switched off/);
    assert.equal(body.needsGmail, false, 'not sent off to Google\'s permission screen for nothing');
  } finally {
    gmailRefusal = null;
  }
});
