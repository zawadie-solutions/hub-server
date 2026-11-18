// Creates email drafts in the signed-in person's own Gmail. Drafts only:
// Ombeni never sends email. The person reviews the draft and sends it from
// Gmail themselves.
const { OAuth2Client } = require('google-auth-library');
const env = require('../config/env');
const authService = require('./authService');
const people = require('../data/people');

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

// What Google's refusal means, from its error details (never just the status:
// a 403 is also what Google sends when the Gmail API is switched off).
//   gmail_api_off        the Gmail API isn't enabled in Ombeni's Google Cloud project (an admin fixes it)
//   no_gmail_permission  this person's Google access doesn't include Gmail (they allow it again)
//   reconnect            their Google access expired or was removed (they connect Google again)
//   other                anything else, with Google's own words
function googleProblem(status, error) {
  const e = error || {};
  const reasons = [
    ...(e.errors || []).map(x => x.reason),
    ...(e.details || []).map(x => x.reason),
    e.status
  ].filter(Boolean).map(String);
  const message = String(e.message || '');
  if (reasons.some(r => /SERVICE_DISABLED|accessNotConfigured/i.test(r)) || /has not been used in project|is disabled/i.test(message)) {
    const info = (e.details || []).find(x => x.metadata && x.metadata.activationUrl);
    return { problem: 'gmail_api_off', activationUrl: info ? info.metadata.activationUrl : null };
  }
  if (reasons.some(r => /SCOPE_INSUFFICIENT|insufficientPermissions/i.test(r)) || /insufficient authentication scopes/i.test(message)) {
    return { problem: 'no_gmail_permission' };
  }
  if (status === 401) return { problem: 'reconnect' };
  return { problem: 'other' };
}

// What happened and what to do, in plain words: passed to Ombeni (which tells
// the person) and shown by the recap-email button.
const REASONS = {
  gmail_api_off: (p) => 'Google refused because the Gmail API is switched off in Ombeni\'s Google Cloud project, so no one\'s drafts can be saved yet. '
    + 'The person can\'t fix this themselves: a hub admin needs to enable the Gmail API for that project in Google Cloud Console '
    + `(APIs & Services > Library > Gmail API > Enable${p.activationUrl ? `, or ${p.activationUrl}` : ''}), then ask again.`,
  no_gmail_permission: () => 'Google says Ombeni doesn\'t have the Gmail permission for this person (the Gmail box was left unticked on Google\'s screen, or the access was removed since). '
    + 'In Settings > Your co-worker they click Allow Gmail drafts again, and on Google\'s screen tick the box for Gmail ("Manage drafts and send emails").',
  reconnect: () => 'The person\'s Google connection has expired or was removed. In Settings > Your co-worker they connect Google again, then click Allow Gmail drafts.',
  other: (p) => `Google refused the draft: ${p.message || 'no reason given'}.`
};

/**
 * Saves a draft in the person's Gmail. Returns { created: true, link } or
 * { created: false, problem, reason } (problem: see googleProblem; reason:
 * what happened and what to do). Never throws. Google's real error is always
 * logged, so it can be found in the server log.
 */
async function createDraft(googleTokens, { to, cc, subject, body }) {
  let token;
  try {
    token = await accessToken(googleTokens);
  } catch (err) {
    const code = String((err.response && err.response.data && err.response.data.error) || err.message);
    console.error(`⚠️ Gmail draft: Google token refresh failed: ${code}`);
    if (/invalid_grant|unauthorized_client|invalid_token/i.test(code)) return { created: false, problem: 'reconnect', reason: REASONS.reconnect() };
    return { created: false, problem: 'other', reason: `Couldn't reach Google: ${err.message}` };
  }
  try {
    const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { raw: rawMessage({ to: to || [], cc, subject, body }) } }),
      signal: AbortSignal.timeout(15000)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = data.error || {};
      const found = googleProblem(response.status, error);
      console.error(`⚠️ Gmail draft refused (${response.status}, ${found.problem}): ${String(error.message || '').slice(0, 300)}`);
      return { created: false, problem: found.problem, reason: REASONS[found.problem]({ ...found, message: error.message || `Gmail error ${response.status}` }) };
    }
    return { created: true, link: `https://mail.google.com/mail/#drafts?compose=${data.message.id}` };
  } catch (err) {
    console.error(`⚠️ Gmail draft: couldn't reach Gmail: ${err.message}`);
    return { created: false, problem: 'other', reason: `Couldn't reach Gmail: ${err.message}` };
  }
}

/**
 * Saves a draft and keeps the person's stored Google connection honest: when
 * Google says the Gmail permission is missing, Settings offers Allow Gmail
 * drafts again; when the access is gone altogether, it shows as broken.
 */
async function createDraftFor(email, googleTokens, draft) {
  const result = await createDraft(googleTokens, draft);
  if (!result.created && email) {
    try {
      if (result.problem === 'no_gmail_permission') await people.forgetGmail(email);
      if (result.problem === 'reconnect') await people.markGoogleBroken(email);
    } catch (err) {
      console.error('⚠️ Gmail draft: couldn\'t update the stored Google connection:', err.message);
    }
  }
  return result;
}

/**
 * What handleChat needs for Gmail drafts, from the person's Google connection:
 * draftEmail when they allowed drafts, otherwise the reason they can't.
 */
function draftOptions(googleTokens, email = null) {
  const allowed = authService.canDraftEmail(googleTokens);
  return {
    draftEmail: allowed
      ? (args) => createDraftFor(email, googleTokens, { to: Array.isArray(args.to) ? args.to : [args.to].filter(Boolean), subject: args.subject, body: args.body })
      : null,
    draftEmailUnavailable: allowed ? null : authService.draftEmailUnavailable(googleTokens)
  };
}

module.exports = { createDraft, createDraftFor, rawMessage, draftOptions, googleProblem, EMAIL_RE };
