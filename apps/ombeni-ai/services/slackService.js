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

module.exports = { isConfigured, sendNotification };
