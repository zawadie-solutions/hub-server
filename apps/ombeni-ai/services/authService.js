const { OAuth2Client } = require('google-auth-library');
const env = require('../config/env');

function isConfigured() {
  return env.isGoogleConfigured;
}

function getClient() {
  return new OAuth2Client(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.GOOGLE_REDIRECT_URI);
}

const GMAIL_COMPOSE = 'https://www.googleapis.com/auth/gmail.compose';

// gmail: also ask to create Gmail drafts. Asked for separately, only when a
// person wants drafts, so connecting a calendar never asks for Gmail.
function getAuthUrl({ gmail = false } = {}) {
  return getClient().generateAuthUrl({
    // offline + consent so Google issues a refresh token every sign-in — needed
    // to call the Calendar API beyond the ~1hr life of the initial access token.
    // Trade-off: the Google consent screen shows every time, not just the first.
    access_type: 'offline',
    prompt: 'consent',
    // Keeps what was granted before (e.g. Gmail drafts) when connecting again.
    include_granted_scopes: true,
    scope: [
      'openid',
      'email',
      'profile',
      'https://www.googleapis.com/auth/calendar.events.readonly',
      ...(gmail ? [GMAIL_COMPOSE] : [])
    ]
  });
}

const canDraftEmail = (googleTokens) => Boolean(googleTokens && String(googleTokens.scope || '').includes('gmail.compose'));

/**
 * Exchanges an OAuth redirect "code" for the signed-in user's verified
 * identity plus their Google tokens. Returns:
 *   { user: { email, name, picture }, googleTokens: { access_token, refresh_token, expiry_date } }
 * `user` is safe to send to the client; `googleTokens` must stay server-side only.
 */
async function exchangeCodeForUser(code) {
  const client = getClient();
  const { tokens } = await client.getToken(code);
  const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: env.GOOGLE_CLIENT_ID });
  const payload = ticket.getPayload();
  if (!payload.email_verified) {
    throw new Error('Google account email is not verified');
  }

  const email = payload.email.toLowerCase();
  if (env.GOOGLE_ALLOWED_DOMAIN && !email.endsWith(`@${env.GOOGLE_ALLOWED_DOMAIN.toLowerCase()}`)) {
    throw new Error(`Sign-in is restricted to @${env.GOOGLE_ALLOWED_DOMAIN} accounts`);
  }

  const user = { email, name: payload.name || payload.email, picture: payload.picture || null };
  const googleTokens = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token || null,
    expiry_date: tokens.expiry_date || null,
    scope: tokens.scope || '' // what the person actually granted (e.g. whether Gmail drafts are allowed)
  };

  return { user, googleTokens };
}

module.exports = { isConfigured, getAuthUrl, exchangeCodeForUser, canDraftEmail };
