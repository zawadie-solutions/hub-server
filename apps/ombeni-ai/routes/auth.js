const express = require('express');
const router = express.Router();

const authService = require('../services/authService');
const store = require('../data/store');
const admins = require('../data/admins');

router.get('/google', (req, res) => {
  if (!authService.isConfigured()) {
    return res.status(503).send('Google sign-in is not configured yet. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.');
  }
  res.redirect(authService.getAuthUrl());
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
    req.appSession.user = { ...req.appSession.user, ...user, email: signedInEmail || user.email };
    req.appSession.googleTokens = googleTokens; // server-side only, used for Calendar API calls
    store.logActivity({ user: req.appSession.user.name, action: 'Connected Google Calendar', source: 'Google', result: 'Success' });
    // Back to this app's home, wherever it's mounted ("/" standalone,
    // "/ombeni-ai/" inside the hub).
    res.redirect(req.baseUrl.replace(/\/auth$/, '') + '/');
  } catch (err) {
    res.status(401).send(`Sign-in failed: ${err.message}`);
  }
});

router.post('/logout', (req, res) => {
  const user = req.appSession.user;
  req.destroyAppSession(() => {
    if (user) store.logActivity({ user: user.name, action: 'Signed out', source: 'Google' });
    res.json({ success: true });
  });
});

router.get('/me', (req, res) => {
  const user = req.appSession.user || null;
  res.json({
    success: true,
    data: {
      googleConfigured: authService.isConfigured(),
      calendarConnected: Boolean(req.appSession.googleTokens),
      user,
      isAdmin: Boolean(user) && admins.isAdmin(user.email)
    }
  });
});

module.exports = router;
