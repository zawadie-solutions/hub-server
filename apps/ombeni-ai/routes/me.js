// Each person's own co-worker settings: their Google connection and what
// Ombeni sends them. Only ever about the signed-in person.
const express = require('express');
const env = require('../config/env');
const people = require('../data/people');

const router = express.Router();
const me = (req) => (req.appSession.user ? req.appSession.user.email.toLowerCase() : null);

router.use((req, res, next) => {
  if (!me(req)) return res.status(401).json({ success: false, error: 'Sign in through the Zawadie Hub first.' });
  next();
});

function view(person) {
  const google = person && person.google;
  return {
    google: google ? { connected: !google.broken, broken: Boolean(google.broken), connectedAt: google.connectedAt, gmailDrafts: (google.scopes || []).some(s => /gmail\.compose/.test(s)) } : null,
    canStore: people.canStoreTokens(),
    slackReady: env.isSlackDmConfigured,
    timeZone: (person && person.timeZone) || null,
    prefs: { morning: !(person && person.prefs && person.prefs.morning === false), prep: !(person && person.prefs && person.prefs.prep === false) }
  };
}

router.get('/coworker', async (req, res) => {
  try {
    res.json({ success: true, data: view(await people.get(me(req))) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/coworker', async (req, res) => {
  try {
    const current = (await people.get(me(req))) || {};
    const prefs = { ...(current.prefs || {}) };
    for (const name of ['morning', 'prep']) if (typeof req.body[name] === 'boolean') prefs[name] = req.body[name];
    res.json({ success: true, data: view(await people.update(me(req), { prefs })) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Disconnect: Google is told to cancel Ombeni's access, and the stored copy is deleted.
router.delete('/google', async (req, res) => {
  try {
    const person = await people.get(me(req));
    const tokens = people.googleTokens(person);
    if (tokens) {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(tokens.refresh_token)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(10000)
      }).catch(err => console.error('⚠️ Google revoke failed (stored copy deleted anyway):', err.message));
    }
    delete req.appSession.googleTokens;
    res.json({ success: true, data: view(await people.forgetGoogle(me(req))) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
