// "Connect Monday": each person signs in to their own Monday account through
// the Ombeni AI app in Monday's Developer Center, so Ombeni sees exactly the
// boards they can open and creates tasks as them.
//
// Works with both of Monday's sign-in methods. The newer one (OAuth 2.1) is
// recognised by the `status` Monday adds when sending the person back: its
// access expires and is renewed here with a refresh token. PKCE is always
// sent: the newer method requires it and the older one accepts it.
const crypto = require('crypto');
const env = require('../config/env');
const people = require('../data/people');

const AUTHORIZE_URL = 'https://auth.monday.com/oauth2/authorize';
const TOKEN_URL = { legacy: 'https://auth.monday.com/oauth2/token', new: 'https://auth.monday.com/oauth_ms/oauth/token' };
const REVOKE_URL = 'https://auth.monday.com/oauth_ms/oauth/revoke';
const API_URL = 'https://api.monday.com/v2';
const REFRESH_EARLY_MS = 5 * 60 * 1000;

const isConfigured = () => Boolean(env.MONDAY_CLIENT_ID && env.MONDAY_CLIENT_SECRET && people.canStoreTokens());

const b64url = (buf) => Buffer.from(buf).toString('base64url');

/** A fresh state (stops forged callbacks) and PKCE pair, kept in the person's session until Monday sends them back. */
function startSignIn() {
  const verifier = b64url(crypto.randomBytes(32));
  return {
    state: b64url(crypto.randomBytes(16)),
    verifier,
    challenge: b64url(crypto.createHash('sha256').update(verifier).digest()),
    at: Date.now()
  };
}

function authorizeUrl({ state, challenge }) {
  const params = new URLSearchParams({
    client_id: env.MONDAY_CLIENT_ID,
    redirect_uri: env.MONDAY_REDIRECT_URI,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    // If the app isn't installed on the account yet, Monday asks an admin first.
    force_install_if_needed: 'true'
  });
  return `${AUTHORIZE_URL}?${params}`;
}

/** The expiry (ms) in a JWT access token, or null for tokens that don't expire. */
function expiryOf(token) {
  try {
    const payload = JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8'));
    return payload.exp ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    const err = new Error(data.error_description || data.error || `Monday sign-in failed (${response.status})`);
    err.code = data.error;
    throw err;
  }
  return data;
}

async function whoAmI(accessToken) {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: accessToken },
    body: JSON.stringify({ query: '{ me { id name email account { id slug } } }' }),
    signal: AbortSignal.timeout(15000)
  });
  const result = await response.json();
  if (result.errors || !result.data || !result.data.me) throw new Error('Monday didn\'t say who signed in.');
  return result.data.me;
}

/**
 * Finishes sign-in: swaps the code for access, checks it's the signed-in
 * person's own Monday account, and stores it (encrypted). Returns the person
 * record, or throws with a message to show them.
 */
async function finishSignIn({ email, code, status, pending }) {
  const flow = status ? 'new' : 'legacy';
  const body = {
    client_id: env.MONDAY_CLIENT_ID,
    client_secret: env.MONDAY_CLIENT_SECRET,
    code,
    redirect_uri: env.MONDAY_REDIRECT_URI,
    code_verifier: pending.verifier,
    ...(flow === 'new' ? { grant_type: 'authorization_code' } : {})
  };
  const tokens = await postJson(TOKEN_URL[flow], body);
  const me = await whoAmI(tokens.access_token);
  if (String(me.email || '').toLowerCase() !== String(email).toLowerCase()) {
    if (tokens.refresh_token) await revoke(tokens.refresh_token, 'refresh_token').catch(() => {});
    throw new Error(`You're signed in to the Zawadie Hub as ${email}, so connect that same Monday account (you chose ${me.email}).`);
  }
  return people.update(email, {
    monday: {
      enc: people.encrypt(JSON.stringify({ access: tokens.access_token, refresh: tokens.refresh_token || null })),
      flow,
      expiresAt: expiryOf(tokens.access_token),
      userId: String(me.id),
      name: me.name,
      account: me.account ? me.account.slug : null,
      connectedAt: new Date().toISOString(),
      broken: false
    }
  });
}

function stored(person) {
  if (!person || !person.monday || person.monday.broken || !people.canStoreTokens()) return null;
  const raw = people.decrypt(person.monday.enc);
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// One renewal at a time per person: the newer method rotates refresh tokens,
// and using an old one twice can cancel the whole connection.
const refreshing = new Map();

async function refresh(email, person, current) {
  const tokens = await postJson(TOKEN_URL.new, {
    grant_type: 'refresh_token',
    client_id: env.MONDAY_CLIENT_ID,
    client_secret: env.MONDAY_CLIENT_SECRET,
    refresh_token: current.refresh
  });
  await people.update(email, {
    monday: {
      ...person.monday,
      enc: people.encrypt(JSON.stringify({ access: tokens.access_token, refresh: tokens.refresh_token || current.refresh })),
      expiresAt: expiryOf(tokens.access_token)
    }
  });
  return tokens.access_token;
}

/**
 * A working Monday access token for this person, renewed if it's about to
 * expire, or null if they haven't connected (or the connection broke and
 * they need to connect again).
 */
async function tokenFor(email, now = Date.now()) {
  const person = await people.get(email);
  const current = stored(person);
  if (!current) return null;
  const { expiresAt } = person.monday;
  if (!expiresAt || expiresAt - now > REFRESH_EARLY_MS || !current.refresh) return current.access;

  if (!refreshing.has(email)) {
    refreshing.set(email, refresh(email, person, current).finally(() => refreshing.delete(email)));
  }
  try {
    return await refreshing.get(email);
  } catch (err) {
    console.error(`⚠️ Monday renewal failed for ${email}:`, err.message);
    if (err.code === 'invalid_grant') {
      await people.update(email, { monday: { ...person.monday, broken: true } });
      return null;
    }
    // Still valid for a few minutes: use it rather than fail the request.
    return expiresAt > now ? current.access : null;
  }
}

async function revoke(token, hint) {
  return postJson(REVOKE_URL, { token, client_id: env.MONDAY_CLIENT_ID, client_secret: env.MONDAY_CLIENT_SECRET, token_type_hint: hint });
}

/** Disconnect: cancels the access at Monday when it can (newer method), and deletes the stored copy. */
async function disconnect(email) {
  const person = await people.get(email);
  const current = stored(person);
  if (current && current.refresh && person.monday.flow === 'new') {
    await revoke(current.refresh, 'refresh_token').catch(err => console.error('⚠️ Monday revoke failed (stored copy deleted anyway):', err.message));
  }
  return people.update(email, { monday: null });
}

module.exports = { isConfigured, startSignIn, authorizeUrl, finishSignIn, tokenFor, disconnect, expiryOf, TOKEN_URL };
