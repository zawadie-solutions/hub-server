// Slack calling Ombeni: button presses on an assignment DM, and replies in its
// thread. Reached through the hub's public hooks (no hub login), so every call
// must carry Slack's signature, and every action checks that the person in
// Slack owns the assignment (by their Slack email).
//
//   POST /hooks/ombeni-ai/slack-events        Event Subscriptions (message.im)
//   POST /hooks/ombeni-ai/slack-interactions  Interactivity (buttons)
const crypto = require('crypto');
const path = require('path');
const env = require('../config/env');
const store = require('../data/store');
const workStore = require('../data/workStore');
const slackService = require('./slackService');
const workActions = require('./workActions');
const statementService = require('./statementService');
const openaiService = require('./openaiService');
const { extractText, imageOf, WORK_SUPPORTED } = require('./fileParser');
const replies = require('./slackReplies');

const MAX_AGE_S = 5 * 60;

/**
 * Slack's request signing (v0): HMAC-SHA256 of "v0:<timestamp>:<raw body>".
 * Returns 'ok', or why not: 'no_secret' | 'no_body' | 'stale' | 'mismatch'.
 */
function check(rawBody, headers, secret = env.SLACK_SIGNING_SECRET, now = Date.now()) {
  if (!secret) return 'no_secret';
  if (!Buffer.isBuffer(rawBody)) return 'no_body';
  const ts = Number(headers['x-slack-request-timestamp']);
  const sig = String(headers['x-slack-signature'] || '');
  if (!ts || Math.abs(now / 1000 - ts) > MAX_AGE_S) return 'stale';
  const expected = `v0=${crypto.createHmac('sha256', secret).update(`v0:${ts}:${rawBody.toString('utf8')}`).digest('hex')}`;
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? 'ok' : 'mismatch';
}

const verify = (...args) => check(...args) === 'ok';

// Refuses a call that isn't Slack's, saying plainly which setting is wrong
// (never the secret itself), so a setup problem can be found from outside.
function refuse(req, res) {
  const reason = check(req.body, req.headers);
  if (reason === 'ok') return false;
  console.error(`⚠️ Slack call refused (${reason}): ${req.originalUrl}`);
  if (reason === 'no_secret') res.status(503).send('The Slack signing secret is not set on the server (OMBENI_SLACK_SIGNING_SECRET).');
  else if (reason === 'no_body') res.status(500).send('The request body did not reach Ombeni unchanged.');
  else if (reason === 'stale') res.status(401).send('Request too old or missing its Slack timestamp.');
  else res.status(401).send('Invalid signature: the signing secret on the server does not match this Slack app.');
  return true;
}

// Slack retries an event it thinks went unanswered; each is handled once.
const seen = new Map();
function firstTime(id) {
  if (!id) return true;
  const now = Date.now();
  for (const [key, at] of seen) if (now - at > 3600000) seen.delete(key);
  if (seen.has(id)) return false;
  seen.set(id, now);
  return true;
}

const myWorkLink = () => `${env.APP_URL.endsWith('/') ? env.APP_URL : `${env.APP_URL}/`}#work`;
const AI_DOWN = 'I couldn\'t check that just now. Try again in a minute, or use My Work.';
const NOT_YOURS = 'This assignment isn\'t yours anymore, so I can\'t act on it here. Your work is in My Work.';

// The assignment, if the Slack user owns it; otherwise null (after telling them).
async function ownedAssignment(assignment, slackUserId, reply) {
  if (!assignment) return null;
  const email = await slackService.emailOfUser(slackUserId);
  if (!email || email !== assignment.ownerEmail) {
    await reply(replies.plain(NOT_YOURS));
    return null;
  }
  return assignment;
}

async function handleThreadReply(event) {
  const reply = (message) => slackService.postMessage(event.channel, event.thread_ts, message);
  const found = await statementService.assignmentForThread(event.channel, event.thread_ts);
  if (!found) return reply(replies.plain("I can't find this assignment anymore (a deleted sample, maybe). Your work is in My Work."));
  const assignment = await ownedAssignment(found, event.user, reply);
  if (!assignment) return;
  return respondAbout(assignment, event, reply);
}

// The person's most recent open assignment sent to them in this DM, for a
// message typed in the main box rather than in an assignment's thread.
async function latestOpenAssignment(slackUserId, channel) {
  const email = await slackService.emailOfUser(slackUserId);
  if (!email) return null;
  return (await workStore.assignmentsForOwner(email))
    .filter(a => a.status !== 'done' && a.slack && a.slack.channel === channel && a.slack.ts)
    .sort((a, b) => Number(b.slack.ts) - Number(a.slack.ts))[0] || null;
}

// A message in the main DM box: taken as being about their latest open
// assignment, answered under their message, saying which assignment it was.
async function handleTopLevel(event) {
  const assignment = await latestOpenAssignment(event.user, event.channel);
  if (!assignment) return slackService.postMessage(event.channel, event.ts, replies.HELP(myWorkLink()));
  const reply = (message) => slackService.postMessage(event.channel, event.ts, replies.about(assignment.title, message));
  return respondAbout(assignment, event, reply);
}

// What a reply does, wherever it came from: a draft is checked, a question
// answered from the meeting, anything else checked as their explanation.
async function respondAbout(assignment, event, reply) {

  // An attached draft: check it.
  const file = (event.files || [])[0];
  if (file) {
    const ext = path.extname(file.name || '').toLowerCase();
    if (!WORK_SUPPORTED.includes(ext)) return reply(replies.plain(`I can check ${WORK_SUPPORTED.join(', ')} files. For anything else, paste the text or describe what you did, in My Work.`));
    let text;
    let image = null;
    try {
      const buffer = await slackService.downloadFile(file);
      // A picture is looked at as it is, with anything typed alongside as notes.
      image = imageOf({ originalname: file.name, buffer });
      text = image ? replies.cleanSlackText(event.text) : await extractText({ originalname: file.name, buffer });
    } catch (err) {
      return reply(replies.plain(`I couldn't read that file: ${err.message}.`));
    }
    if (!text && !image) return reply(replies.plain('That file looks empty to me.'));
    try {
      const { check } = await workActions.checkWork(assignment, text, file.name, image);
      return reply(replies.workReply(check));
    } catch (err) {
      console.error('⚠️ Slack work check failed:', err.message);
      return reply(replies.plain(AI_DOWN));
    }
  }

  const text = replies.cleanSlackText(event.text);
  if (!text) return;

  // A question: answered from the meeting, about this assignment only.
  if (text.endsWith('?')) {
    try {
      const answer = await openaiService.askAboutAssignment(assignment, store.getMeeting(assignment.meetingId), [{ role: 'user', content: text.slice(0, 4000) }]);
      return reply({ text: answer, blocks: [{ type: 'section', text: { type: 'mrkdwn', text: String(answer).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').slice(0, 2900) } }] });
    } catch (err) {
      console.error('⚠️ Slack question failed:', err.message);
      return reply(replies.plain(AI_DOWN));
    }
  }

  // Anything else is their explanation of what they'll deliver.
  if (text.length < 15) return reply(replies.plain('Tell me in a sentence or two what you\'re going to deliver, by when, and to whom, and I\'ll check you\'ve got it all. Or end with ? to ask me something.'));
  try {
    const wasNew = assignment.status === 'new';
    const { assignment: saved, result } = await workActions.explain(assignment, text);
    return reply(replies.explainReply(result, { confirmedNow: wasNew && saved.status === 'confirmed' }));
  } catch (err) {
    console.error('⚠️ Slack explain-back failed:', err.message);
    return reply(replies.plain(AI_DOWN));
  }
}

async function handleEvent(event) {
  if (!event || event.type !== 'message' || event.channel_type !== 'im') return;
  if (event.bot_id || !event.user) return; // includes Ombeni's own messages
  if (event.subtype && event.subtype !== 'file_share') return; // edits, deletions...
  if (!event.thread_ts || event.thread_ts === event.ts) return handleTopLevel(event);
  return handleThreadReply(event);
}

async function events(req, res) {
  if (refuse(req, res)) return;
  let body;
  try {
    body = JSON.parse(req.body.toString('utf8'));
  } catch {
    return res.status(400).send('Bad request');
  }
  if (body.type === 'url_verification') return res.json({ challenge: body.challenge });
  // Slack wants an answer within 3 seconds; the work carries on after it.
  res.status(200).end();
  if (body.type === 'event_callback' && firstTime(body.event_id)) {
    await handleEvent(body.event).catch(err => console.error('⚠️ Slack event failed:', err.message));
  }
}

async function handleAction(payload) {
  const action = (payload.actions || [])[0];
  if (!action || !['ombeni_got_it', 'ombeni_not_mine'].includes(action.action_id)) return; // "Open in Ombeni" is just a link
  const channel = (payload.channel && payload.channel.id) || (payload.container && payload.container.channel_id);
  const ts = (payload.message && payload.message.ts) || (payload.container && payload.container.message_ts);
  const reply = (message) => slackService.postMessage(channel, ts, message);

  const assignment = await ownedAssignment(await workStore.getAssignment(String(action.value || '')), payload.user && payload.user.id, reply);
  if (!assignment) return;

  if (action.action_id === 'ombeni_got_it') {
    if (assignment.status !== 'new') return reply(replies.plain('Already marked as Got it. When your draft is ready, attach it here and I\'ll check it before you deliver.'));
    await workActions.respond(assignment, 'got_it', assignment.ownerEmail);
    return reply(replies.plain('Marked as Got it. Tip: reply here with what you\'ll deliver, in your own words, and I\'ll check you haven\'t missed anything.'));
  }
  await workActions.respond(assignment, 'not_mine', assignment.ownerEmail);
  return reply(replies.plain(`Given back. The other Zawadie people from ${assignment.meetingTitle} can take it now.`));
}

async function interactions(req, res) {
  if (refuse(req, res)) return;
  let payload;
  try {
    payload = JSON.parse(new URLSearchParams(req.body.toString('utf8')).get('payload') || '{}');
  } catch {
    return res.status(400).send('Bad request');
  }
  res.status(200).end();
  if (payload.type === 'block_actions') {
    await handleAction(payload).catch(err => console.error('⚠️ Slack button failed:', err.message));
  }
}

module.exports = { verify, check, events, interactions, handleEvent, handleAction };
