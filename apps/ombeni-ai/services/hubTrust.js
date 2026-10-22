// Verifies the signed identity header the Zawadie Hub attaches to every
// proxied request (see hub-server/server.js: signHubIdentity). Lets this
// app trust a login that already happened at the hub instead of running
// its own — the hub is meant to be the only sign-in screen.
const crypto = require('node:crypto');
const env = require('../config/env');

const MAX_SKEW_MS = 5 * 60 * 1000;

function verifyHubUser(req) {
  // Running inside the hub: it has already checked the login and hands the
  // user over directly (a request property, which no client can set).
  if (req.hubUser) return { email: String(req.hubUser.email).toLowerCase(), role: String(req.hubUser.role) };
  if (!env.SSO_SHARED_SECRET) return null;

  const email = req.headers['x-zawadie-user-email'];
  const role = req.headers['x-zawadie-user-role'];
  const ts = req.headers['x-zawadie-user-ts'];
  const sig = req.headers['x-zawadie-user-sig'];
  if (!email || !role || !ts || !sig) return null;
  if (Math.abs(Date.now() - Number(ts)) > MAX_SKEW_MS) return null;

  const expected = crypto.createHmac('sha256', env.SSO_SHARED_SECRET).update(`${email}|${role}|${ts}`).digest('hex');
  const sigBuf = Buffer.from(String(sig), 'hex');
  const expBuf = Buffer.from(expected, 'hex');
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;

  return { email: String(email).toLowerCase(), role: String(role) };
}

function nameFromEmail(email) {
  return email
    .split('@')[0]
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

module.exports = { verifyHubUser, nameFromEmail };
