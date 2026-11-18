// Creates email drafts in the signed-in person's own Gmail. Drafts only:
// Ombeni never sends email. The person reviews the draft and sends it from
// Gmail themselves.
const { OAuth2Client } = require('google-auth-library');
const env = require('../config/env');
const authService = require('./authService');

async function accessToken(googleTokens) {
  const client = new OAuth2Client(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.GOOGLE_REDIRECT_URI);
  client.setCredentials({ refresh_token: googleTokens.refresh_token, access_token: googleTokens.access_token, expiry_date: googleTokens.expiry_date });
  return (await client.getAccessToken()).token;
}

const EMAIL_RE = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;

// Non-ASCII header text (names, subjects) must be encoded for email.
const encodeHeader = (s) => (/^[\x20-\x7E]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`);

/** The raw RFC 2822 message Gmail expects, base64url-encoded. Exported for tests. */
function rawMessage({ to, cc = [], subject, body }) {
  const clean = (list) => [...new Set((list || []).map(e => String(e).trim().toLowerCase()).filter(e => EMAIL_RE.test(e)))];
  const headers = [
    to.length ? `To: ${clean(to).join(', ')}` : null,
    clean(cc).length ? `Cc: ${clean(cc).join(', ')}` : null,
    `Subject: ${encodeHeader(String(subject || '').replace(/[\r\n]+/g, ' ').slice(0, 250))}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64'
  ].filter(Boolean);
  const message = `${headers.join('\r\n')}\r\n\r\n${Buffer.from(String(body || ''), 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n')}`;
  return Buffer.from(message, 'utf8').toString('base64url');
}

/**
 * Saves a draft in the person's Gmail. Returns { created: true, link } or
 * { created: false, reason }. Never throws.
 */
async function createDraft(googleTokens, { to, cc, subject, body }) {
  try {
    const token = await accessToken(googleTokens);
    const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { raw: rawMessage({ to: to || [], cc, subject, body }) } }),
      signal: AbortSignal.timeout(15000)
    });
    const data = await response.json();
    if (!response.ok) {
      const reason = response.status === 403 ? 'Ombeni isn\'t allowed to create Gmail drafts for you yet' : (data.error && data.error.message) || `Gmail error ${response.status}`;
      return { created: false, reason };
    }
    return { created: true, link: `https://mail.google.com/mail/#drafts?compose=${data.message.id}` };
  } catch (err) {
    return { created: false, reason: `Couldn't reach Gmail: ${err.message}` };
  }
}

/**
 * What handleChat needs for Gmail drafts, from the person's Google connection:
 * draftEmail when they allowed drafts, otherwise the reason they can't.
 */
function draftOptions(googleTokens) {
  const allowed = authService.canDraftEmail(googleTokens);
  return {
    draftEmail: allowed
      ? (email) => createDraft(googleTokens, { to: Array.isArray(email.to) ? email.to : [email.to].filter(Boolean), subject: email.subject, body: email.body })
      : null,
    draftEmailUnavailable: allowed ? null : authService.draftEmailUnavailable(googleTokens)
  };
}

module.exports = { createDraft, rawMessage, draftOptions, EMAIL_RE };
