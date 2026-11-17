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
    return { sent: true };
  } catch (err) {
    return { sent: false, reason: `Couldn't reach Slack: ${err.message}` };
  }
}

module.exports = { isConfigured, sendNotification, sendDirectMessage };
