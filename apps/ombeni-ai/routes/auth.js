const express = require('express');
const router = express.Router();

const authService = require('../services/authService');
const admins = require('../data/admins');
const people = require('../data/people');
const mondayAuth = require('../services/mondayAuth');

router.get('/google', (req, res) => {
  if (!authService.isConfigured()) {
    return res.status(503).send('Google sign-in is not configured yet. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.');
  }
  res.redirect(authService.getAuthUrl({ gmail: req.query.gmail === '1' }));
});

router.get('/google/callback', async (req, res) => {
  try {
    if (!req.query.code) throw new Error('Missing authorization code');
    const { user, googleTokens } = await authService.exchangeCodeForUser(req.query.code);
    // This is now a "connect Google Calendar" action, not the sign-in gate
    // (that's the hub's job — see services/hubTrust.js). Merge Google's
    // richer profile (name, picture) onto whatever identity is already
    // there rather than replacing it, so a hub-sourced email can't be
    // swapped out by connecting a different Google account.
    const signedInEmail = req.appSession.user && req.appSession.user.email;
    // Ombeni reads this calendar for whoever is signed in, so it must be
    // their own Google account, not someone else's.
    if (signedInEmail && signedInEmail.toLowerCase() !== user.email.toLowerCase()) {
      return res.status(403).send(`You're signed in to the Zawadie Hub as ${signedInEmail}, so connect that same Google account (you chose ${user.email}).`);
    }
    req.appSession.user = { ...req.appSession.user, ...user, email: signedInEmail || user.email };
    req.appSession.googleTokens = googleTokens; // server-side only, used for Calendar API calls
    // Kept (encrypted) so Ombeni can prepare your morning message and meeting
    // notes while you're not signed in. You can disconnect in Settings.
    await people.saveGoogle(req.appSession.user.email, googleTokens, user.name);
    // Back to this app's home, wherever it's mounted ("/" standalone,
    // "/ombeni-ai/" inside the hub).
    res.redirect(req.baseUrl.replace(/\/auth$/, '') + '/');
  } catch (err) {
    res.status(401).send(`Sign-in failed: ${err.message}`);
  }
});

// ---- Connect Monday (each person's own Monday account) ----

const appHome = (req) => req.baseUrl.replace(/\/auth$/, '') + '/';
const SIGN_IN_TTL_MS = 15 * 60 * 1000;

router.get('/monday', (req, res) => {
  if (!req.appSession.user) return res.status(401).type('text/plain').send('Open Ombeni through the Zawadie Hub first.');
  if (!mondayAuth.isConfigured()) return res.status(503).type('text/plain').send('Connect Monday isn\'t set up on the server yet (OMBENI_MONDAY_CLIENT_ID / OMBENI_MONDAY_CLIENT_SECRET).');
  const pending = mondayAuth.startSignIn();
  req.appSession.mondaySignIn = pending;
  res.redirect(mondayAuth.authorizeUrl(pending));
});

router.get('/monday/callback', async (req, res) => {
  const pending = req.appSession.mondaySignIn;
  delete req.appSession.mondaySignIn;
  const fail = (status, message) => res.status(status).type('text/plain').send(`Connecting Monday didn't work: ${message}`);
  try {
    if (!req.appSession.user) return fail(401, 'you\'re not signed in to the Zawadie Hub.');
    // The state proves this sign-in was started here, by this person.
    if (!pending || !req.query.state || req.query.state !== pending.state || Date.now() - pending.at > SIGN_IN_TTL_MS) {
      return fail(400, 'the sign-in link expired or didn\'t come from here. Try Connect Monday again.');
    }
    if (req.query.error) return fail(400, req.query.error === 'access_denied' ? 'you chose not to allow access.' : String(req.query.error).slice(0, 100));
    if (req.query.status && /deni|reject|cancel|error|fail/i.test(String(req.query.status))) return fail(400, 'you chose not to allow access.');
    if (!req.query.code) return fail(400, 'Monday didn\'t send a sign-in code.');

    await mondayAuth.finishSignIn({ email: req.appSession.user.email, code: String(req.query.code), status: req.query.status, pending });
    res.redirect(`${appHome(req)}#settings`);
  } catch (err) {
    console.error('⚠️ Connect Monday failed:', err.message);
    fail(400, err.message);
  }
});

router.post('/logout', (req, res) => {
  req.destroyAppSession(() => res.json({ success: true }));
});

router.get('/me', async (req, res) => {
  const user = req.appSession.user || null;
  try {
    // A connection stored earlier (on another device, or before the session
    // expired) counts too.
    if (user && !req.appSession.googleTokens) {
      const stored = people.googleTokens(await people.get(user.email));
      if (stored) req.appSession.googleTokens = stored;
    }
    res.json({
      success: true,
      data: {
        googleConfigured: authService.isConfigured(),
        calendarConnected: Boolean(req.appSession.googleTokens),
        user,
        isAdmin: Boolean(user) && await admins.isAdmin(user.email)
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
