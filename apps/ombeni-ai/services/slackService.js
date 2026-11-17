const env = require('../config/env');

const SLACK_POST_MESSAGE_URL = 'https://slack.com/api/chat.postMessage';

function isConfigured() {
  return env.isSlackConfigured;
}

/**
 * Posts a message to the configured Slack channel. No-ops gracefully with
 * { sent: false, reason: 'not_configured' } until SLACK_BOT_TOKEN / SLACK_CHANNEL
 * are set, so callers don't need to special-case Slack being unavailable yet.
 */
async function sendNotification({ text, channel } = {}) {
  if (!isConfigured()) {
    return { sent: false, reason: 'not_configured' };
  }

  const response = await fetch(SLACK_POST_MESSAGE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.SLACK_BOT_TOKEN}`
    },
    body: JSON.stringify({
      channel: channel || env.SLACK_CHANNEL,
      text
    })
  });

  const result = await response.json();
  if (!result.ok) {
    return { sent: false, reason: 'slack_error', error: result.error };
  }

  return { sent: true, ts: result.ts };
}

async function slackApi(method, { query, body } = {}) {
  const qs = query ? `?${new URLSearchParams(query)}` : '';
  const response = await fetch(`https://slack.com/api/${method}${qs}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: `Bearer ${env.SLACK_BOT_TOKEN}` },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000)
  });
  return response.json();
}

// Plain-language reasons for the Slack errors a person is likely to hit.
const REASONS = {
  missing_scope: 'the Ombeni Slack app needs the users:read.email permission to find people by email',
  users_not_found: 'no Slack account uses this email address',
  not_authed: 'the Slack bot token is missing or wrong',
  invalid_auth: 'the Slack bot token is missing or wrong',
  account_inactive: 'the Slack bot token is no longer active'
};

/**
 * Sends a direct message to the Slack account that uses this email. Never
 * throws: returns { sent: true } or { sent: false, reason }.
 */
async function sendDirectMessage(email, { text, blocks }) {
  if (!env.isSlackDmConfigured) return { sent: false, reason: 'Slack is not connected' };
  try {
    const found = await slackApi('users.lookupByEmail', { query: { email } });
    if (!found.ok) return { sent: false, reason: REASONS[found.error] || `Slack error: ${found.error}` };
    // A user id as the channel posts into the bot's DM with that person.
    const posted = await slackApi('chat.postMessage', { body: { channel: found.user.id, text, blocks, unfurl_links: false } });
    if (!posted.ok) return { sent: false, reason: REASONS[posted.error] || `Slack error: ${posted.error}` };
    // Where the message landed, so replies in its thread can be matched back to it.
    return { sent: true, channel: posted.channel, ts: posted.ts };
  } catch (err) {
    return { sent: false, reason: `Couldn't reach Slack: ${err.message}` };
  }
}

/** Replies in a thread (or the channel, without threadTs). Never throws. */
async function postMessage(channel, threadTs, { text, blocks }) {
  try {
    const posted = await slackApi('chat.postMessage', { body: { channel, thread_ts: threadTs || undefined, text, blocks, unfurl_links: false } });
    if (!posted.ok) console.error('⚠️ Slack reply failed:', posted.error);
    return Boolean(posted.ok);
  } catch (err) {
    console.error('⚠️ Slack reply failed:', err.message);
    return false;
  }
}

// Who a Slack user is (their email decides what's theirs). Kept for an hour.
const emailCache = new Map();
const EMAIL_TTL_MS = 60 * 60 * 1000;

async function emailOfUser(userId) {
  const cached = emailCache.get(userId);
  if (cached && Date.now() - cached.at < EMAIL_TTL_MS) return cached.email;
  const info = await slackApi('users.info', { query: { user: userId } });
  if (!info.ok || !info.user || info.user.is_bot) return null;
  const email = info.user.profile && info.user.profile.email ? info.user.profile.email.toLowerCase() : null;
  emailCache.set(userId, { email, at: Date.now() });
  return email;
}

const MAX_FILE_BYTES = 15 * 1024 * 1024;

/** Downloads a file someone shared with the bot (needs the files:read permission). */
async function downloadFile(file) {
  if (!file || !file.url_private_download) throw new Error('No downloadable file');
  if (file.size > MAX_FILE_BYTES) throw new Error('That file is over 15 MB');
  const response = await fetch(file.url_private_download, {
    headers: { Authorization: `Bearer ${env.SLACK_BOT_TOKEN}` },
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) throw new Error(`Slack file download failed (${response.status})`);
  // Without files:read Slack answers with its sign-in page instead of the file.
  if (/text\/html/.test(response.headers.get('content-type') || '')) throw new Error('the Ombeni Slack app needs the files:read permission');
  return Buffer.from(await response.arrayBuffer());
}

module.exports = { isConfigured, sendNotification, sendDirectMessage, postMessage, emailOfUser, downloadFile };
