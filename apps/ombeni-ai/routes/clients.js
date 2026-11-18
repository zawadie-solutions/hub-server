// Clients: each person's own view of the clients they've met, built only from
// the client meetings they attended, and their own work. Two people can see
// different histories of the same client; nobody sees meetings they weren't in.
const express = require('express');
const store = require('../data/store');
const workStore = require('../data/workStore');
const people = require('../data/people');
const clients = require('../services/clients');

const router = express.Router();
const me = (req) => (req.appSession.user ? req.appSession.user.email.toLowerCase() : null);
const myMeetings = (email) => store.getMeetings().filter(m => (m.participants || []).length && store.isAuthorizedForMeeting(m, email));

router.use((req, res, next) => {
  if (!me(req)) return res.status(401).json({ success: false, error: 'Sign in through the Zawadie Hub first.' });
  next();
});

// The clients a person deleted: { [key]: 'YYYY-MM-DD' deleted on }.
const deletedBy = async (email) => ((await people.get(email)) || {}).deletedClients || {};

// The person's clients, without the ones they deleted.
async function myClients(email) {
  return clients.withoutDeleted(clients.listClients(myMeetings(email)), await deletedBy(email));
}

// What the Clients page gets: the list, and the clients deleted from it (for
// "Deleted by mistake?" and Undo).
async function listResponse(email) {
  const all = clients.listClients(myMeetings(email));
  const deleted = await deletedBy(email);
  return {
    success: true,
    data: clients.withoutDeleted(all, deleted),
    deleted: all.filter(c => clients.isDeleted(c, deleted)).map(c => ({ key: c.key, meetings: c.meetings, lastDate: c.lastDate, deletedOn: deleted[c.key] }))
  };
}

// A client's meetings that the person attended, or [] if they deleted that client.
async function myClientMeetings(email, key) {
  const meetings = clients.meetingsFor(key, myMeetings(email));
  const lastDate = meetings.length ? String(meetings[0].date) : '';
  return clients.isDeleted({ key, lastDate }, await deletedBy(email)) ? [] : meetings;
}

router.get('/', async (req, res) => {
  try {
    res.json(await listResponse(me(req)));
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Summaries are kept for a day per person and set of meetings; a new meeting
// with the client makes a fresh one.
const summaries = new Map();
const SUMMARY_TTL_MS = 24 * 3600 * 1000;
const summaryKey = (email, key, meetings) => `${email}|${key}|${meetings.map(m => m.id).join(',')}`;

// Delete a client from your list (e.g. you no longer work with them). Only
// your list changes: the meeting recordings stay in Meetings, and your
// colleagues keep their own lists. A new meeting with them after today brings
// them back as a client; so does bringing them back by hand (below).
router.delete('/:key', async (req, res) => {
  try {
    const email = me(req);
    const key = String(req.params.key).toLowerCase();
    if (!(await myClients(email)).some(c => c.key === key)) {
      return res.status(404).json({ success: false, error: 'That client isn\'t in your list.' });
    }
    const deletedClients = { ...(await deletedBy(email)), [key]: new Date().toISOString().slice(0, 10) };
    await people.update(email, { deletedClients });
    for (const cacheKey of summaries.keys()) if (cacheKey.startsWith(`${email}|${key}|`)) summaries.delete(cacheKey);
    res.json(await listResponse(email));
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Bring back a client deleted by mistake (Undo, or "Deleted by mistake?").
router.post('/:key/restore', async (req, res) => {
  try {
    const email = me(req);
    const key = String(req.params.key).toLowerCase();
    const deletedClients = { ...(await deletedBy(email)) };
    if (!deletedClients[key]) return res.status(404).json({ success: false, error: 'That client isn\'t deleted.' });
    delete deletedClients[key];
    await people.update(email, { deletedClients });
    res.json(await listResponse(email));
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/:key', async (req, res) => {
  try {
    const key = String(req.params.key).toLowerCase();
    const meetings = await myClientMeetings(me(req), key);
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
    const meetings = await myClientMeetings(me(req), key);
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
