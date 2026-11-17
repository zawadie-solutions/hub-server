// Clients: each person's own view of the clients they've met, built only from
// the client meetings they attended, and their own work. Two people can see
// different histories of the same client; nobody sees meetings they weren't in.
const express = require('express');
const store = require('../data/store');
const workStore = require('../data/workStore');
const clients = require('../services/clients');

const router = express.Router();
const me = (req) => (req.appSession.user ? req.appSession.user.email.toLowerCase() : null);
const myMeetings = (email) => store.getMeetings().filter(m => (m.participants || []).length && store.isAuthorizedForMeeting(m, email));

router.use((req, res, next) => {
  if (!me(req)) return res.status(401).json({ success: false, error: 'Sign in through the Zawadie Hub first.' });
  next();
});

router.get('/', (req, res) => {
  res.json({ success: true, data: clients.listClients(myMeetings(me(req))) });
});

// Summaries are kept for a day per person and set of meetings; a new meeting
// with the client makes a fresh one.
const summaries = new Map();
const SUMMARY_TTL_MS = 24 * 3600 * 1000;
const summaryKey = (email, key, meetings) => `${email}|${key}|${meetings.map(m => m.id).join(',')}`;

router.get('/:key', async (req, res) => {
  try {
    const key = String(req.params.key).toLowerCase();
    const meetings = clients.meetingsFor(key, myMeetings(me(req)));
    if (!meetings.length) return res.status(404).json({ success: false, error: 'No meetings with that client that you attended.' });
    const ids = new Set(meetings.map(m => m.id));
    const [briefs, mine] = await Promise.all([
      workStore.getBriefs([...ids]),
      workStore.assignmentsForOwner(me(req))
    ]);
    const cached = summaries.get(summaryKey(me(req), key, meetings));
    res.json({
      success: true,
      data: {
        key,
        meetings: meetings.map(m => ({ id: m.id, title: m.title, date: m.date, summary: m.analysis ? m.analysis.summary : '' })),
        waiting: briefs.flatMap(b => (b.waitingOnClient || []).map(w => ({ ...w, meetingId: b.meetingId }))),
        mine: mine.filter(a => ids.has(a.meetingId)),
        summary: cached && Date.now() - cached.at < SUMMARY_TTL_MS ? cached.result : null
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/:key/summary', async (req, res) => {
  try {
    const key = String(req.params.key).toLowerCase();
    const meetings = clients.meetingsFor(key, myMeetings(me(req)));
    if (!meetings.length) return res.status(404).json({ success: false, error: 'No meetings with that client that you attended.' });
    let result;
    try {
      result = await clients.clientSummary(key, meetings);
    } catch (err) {
      console.error('⚠️ Client summary failed:', err.message);
      return res.status(502).json({ success: false, error: 'Ombeni couldn\'t summarize this client just now. Try again in a minute.' });
    }
    summaries.set(summaryKey(me(req), key, meetings), { at: Date.now(), result });
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
