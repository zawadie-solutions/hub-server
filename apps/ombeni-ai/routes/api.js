const express = require('express');
const multer = require('multer');
const router = express.Router();

const env = require('../config/env');
const store = require('../data/store');
const knowledgeStore = require('../data/knowledgeStore');
const systemInstructions = require('../data/systemInstructions');
const admins = require('../data/admins');
const settings = require('../data/settings');
const { processMeetingAnalysis, handleChat } = require('../services/openaiService');
const mondayService = require('../services/mondayService');
const slackService = require('../services/slackService');
const authService = require('../services/authService');
const calendarService = require('../services/calendarService');
const { extractText } = require('../services/fileParser');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// --- Status ---------------------------------------------------------------
// (deliberately above requireAuth below, so the login screen can show it pre-login)

router.get('/status', (req, res) => {
  res.json({
    success: true,
    data: {
      openai: env.isOpenAIConfigured,
      monday: mondayService.isConfigured(),
      slack: slackService.isConfigured(),
      google: authService.isConfigured(),
      notetaker: store.isUsingNotetaker()
    }
  });
});

// Identity can come from the Zawadie Hub's trusted header (the normal path)
// or, as a fallback, from connecting Google Calendar directly (see
// services/hubTrust.js and routes/auth.js). Only when NEITHER is set up —
// pure standalone dev with no hub and no Google creds — does the app run
// fully open, same graceful-degradation pattern as Monday/Slack.
function hasIdentitySource() {
  return Boolean(env.SSO_SHARED_SECRET) || authService.isConfigured();
}

function requireAuth(req, res, next) {
  if (!hasIdentitySource()) return next();
  if (!req.appSession.user) return res.status(401).json({ success: false, error: 'Not signed in' });
  next();
}
router.use(requireAuth);

function currentEmail(req) {
  return req.appSession.user ? req.appSession.user.email : null;
}

// Unlike meeting-participant checks, this never falls back to "open" when
// there's no identity source — system instructions shape the AI's behavior
// for every user, so without a verified identity nobody is treated as admin.
function requireAdmin(req, res, next) {
  if (!admins.isAdmin(currentEmail(req))) {
    return res.status(403).json({ success: false, error: 'Admin access required' });
  }
  next();
}

// Without a reliable identity source there's nothing to check participation
// against, so the app runs fully open — same fallback as every other
// integration here. Otherwise this checks meeting.participants against the
// signed-in user's email.
function isAuthorized(req, meeting) {
  if (!hasIdentitySource()) return true;
  return store.isAuthorizedForMeeting(meeting, currentEmail(req));
}

// --- Meetings --------------------------------------------------------------

router.get('/meetings', async (req, res) => {
  await store.ensureFreshMeetings();
  const data = store.getMeetings().filter(m => isAuthorized(req, m));
  res.json({ success: true, data });
});

router.post('/meetings/refresh', async (req, res) => {
  try {
    const data = await store.refreshMeetings();
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

function dayBounds(offsetDays) {
  const start = new Date();
  start.setDate(start.getDate() + offsetDays);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setHours(23, 59, 59, 999);
  return { start: start.toISOString(), end: end.toISOString() };
}

const normalizeTitle = (s) => (s || '').toLowerCase().trim();

// Calendar events for today/tomorrow, cross-referenced against real Notetaker
// recordings (same day + overlapping title) so a meeting that already has a
// recording shows as recorded instead of duplicating it as "upcoming."
router.get('/meetings/upcoming', async (req, res) => {
  const tokens = req.appSession.googleTokens;
  if (!tokens || !tokens.refresh_token) {
    // Sessions started before calendar access was added won't have a refresh
    // token yet — signing out and back in grants it.
    return res.json({
      success: true,
      data: { calendarAvailable: false, today: [], tomorrow: [], reason: 'no_refresh_token' }
    });
  }

  try {
    const todayRange = dayBounds(0);
    const tomorrowRange = dayBounds(1);
    const [todayEvents, tomorrowEvents] = await Promise.all([
      calendarService.listEventsForRange(tokens, todayRange.start, todayRange.end),
      calendarService.listEventsForRange(tokens, tomorrowRange.start, tomorrowRange.end)
    ]);

    await store.ensureFreshMeetings();
    const recorded = store.getMeetings().filter(m => isAuthorized(req, m));
    const withRecordedMatch = (events) => events.map(e => {
      const eventDate = e.start.slice(0, 10);
      const eventTitle = normalizeTitle(e.title);
      const match = recorded.find(m => m.date === eventDate && (
        normalizeTitle(m.title).includes(eventTitle) || eventTitle.includes(normalizeTitle(m.title))
      ));
      return { ...e, recordedMeetingId: match ? match.id : null };
    });

    res.json({
      success: true,
      data: { calendarAvailable: true, today: withRecordedMatch(todayEvents), tomorrow: withRecordedMatch(tomorrowEvents) }
    });
  } catch (err) {
    console.error('Calendar fetch failed:', err.message);
    res.json({ success: true, data: { calendarAvailable: false, today: [], tomorrow: [], reason: 'calendar_error', error: err.message } });
  }
});

router.get('/meetings/:id', (req, res) => {
  const meeting = store.getMeeting(req.params.id);
  if (!meeting) return res.status(404).json({ success: false, error: 'Meeting not found' });
  if (!isAuthorized(req, meeting)) {
    return res.status(403).json({ success: false, error: 'restricted' });
  }
  res.json({ success: true, data: meeting });
});

// Bulk delete (admin only). Declared before the single-delete :id route so
// "bulk-delete" can never be mistaken for a meeting id — though since this is
// POST and the :id route below is DELETE, Express wouldn't actually confuse
// them either way.
router.post('/meetings/bulk-delete', requireAdmin, (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
  if (!ids.length) return res.status(400).json({ success: false, error: 'No meeting ids provided' });

  const removed = store.deleteMeetings(ids);
  store.logActivity({
    user: req.appSession.user.name,
    action: `Deleted ${removed.length} meeting${removed.length === 1 ? '' : 's'}`,
    source: 'Meetings'
  });
  res.json({ success: true, data: { deletedCount: removed.length } });
});

router.delete('/meetings/:id', requireAdmin, (req, res) => {
  const meeting = store.getMeeting(req.params.id);
  if (!meeting) return res.status(404).json({ success: false, error: 'Meeting not found' });

  store.deleteMeetings([meeting.id]);
  store.logActivity({ user: req.appSession.user.name, action: `Deleted meeting "${meeting.title}"`, source: 'Meetings' });
  res.json({ success: true });
});

router.post('/meetings/:id/analyze', async (req, res) => {
  try {
    const meeting = store.getMeeting(req.params.id);
    if (!meeting) return res.status(404).json({ success: false, error: 'Meeting not found' });
    if (!isAuthorized(req, meeting)) {
      return res.status(403).json({ success: false, error: 'restricted' });
    }

    const analysis = await processMeetingAnalysis(meeting);
    const updated = store.setMeetingAnalysis(meeting.id, analysis);
    store.logActivity({ action: `Analyzed meeting "${meeting.title}" with AI`, source: 'Ombeni AI' });

    // Action items go straight to Monday.com — no separate manual step.
    await store.syncActionItemsToMonday(updated);

    res.json({ success: true, data: updated });
  } catch (err) {
    store.logActivity({ action: `Failed to analyze meeting ${req.params.id}`, source: 'Ombeni AI', result: 'Error' });
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- Knowledge base -------------------------------------------------------

router.get('/knowledge', (req, res) => {
  res.json({ success: true, data: knowledgeStore.listDocuments() });
});

router.get('/knowledge/:id', (req, res) => {
  const doc = knowledgeStore.getDocument(req.params.id);
  if (!doc) return res.status(404).json({ success: false, error: 'Document not found' });
  res.json({ success: true, data: doc });
});

// Add a document either by uploading a file (.txt/.md/.docx/.pdf) or by pasting text.
router.post('/knowledge', requireAdmin, upload.single('file'), async (req, res) => {
  try {
    let title = (req.body.title || '').trim();
    let body = (req.body.body || '').trim();

    if (req.file) {
      body = await extractText(req.file);
      if (!title) title = req.file.originalname.replace(/\.[^/.]+$/, '');
    }

    if (!body) return res.status(400).json({ success: false, error: 'Upload a file or paste some text first.' });
    if (!title) title = 'Untitled document';

    const doc = knowledgeStore.addDocument({ title, body });
    store.logActivity({ action: `Added knowledge document "${doc.title}"`, source: 'Knowledge base' });
    res.json({ success: true, data: doc });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.put('/knowledge/:id', requireAdmin, (req, res) => {
  const { title, body } = req.body;
  const doc = knowledgeStore.updateDocument(req.params.id, { title, body });
  if (!doc) return res.status(404).json({ success: false, error: 'Document not found' });
  store.logActivity({ action: `Edited knowledge document "${doc.title}"`, source: 'Knowledge base' });
  res.json({ success: true, data: doc });
});

router.delete('/knowledge/:id', requireAdmin, (req, res) => {
  const doc = knowledgeStore.getDocument(req.params.id);
  if (!doc) return res.status(404).json({ success: false, error: 'Document not found' });
  knowledgeStore.deleteDocument(req.params.id);
  store.logActivity({ action: `Deleted knowledge document "${doc.title}"`, source: 'Knowledge base' });
  res.json({ success: true });
});

// --- Chat (Ask Ombeni) ------------------------------------------------------

// Extracts text from a file attached to an Ask Ombeni message. This does NOT
// save into the knowledge base — it's one-off context for a single question.
router.post('/chat/attachment', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'No file provided' });
    const text = await extractText(req.file);
    store.logActivity({ action: `Attached file "${req.file.originalname}" to Ask Ombeni`, source: 'Ombeni AI' });
    res.json({ success: true, data: { filename: req.file.originalname, text } });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/chat', async (req, res) => {
  try {
    const { messages, meetingId } = req.body;
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ success: false, error: 'messages array is required' });
    }

    // Chat answers must be accurate, not just "recently fresh" — unlike the
    // Meetings/Upcoming list views, always pull a live snapshot before
    // building the prompt rather than tolerating the 2-minute staleness window.
    await store.refreshMeetings();

    // Every recorded meeting used to get stuffed into every chat request,
    // which scaled with however many meetings Notetaker had ever recorded —
    // an org with a real meeting history blew past OpenAI's per-minute token
    // limit on an ordinary question. Cap to the most recent meetings instead;
    // older ones are still reachable by asking from that meeting's own page
    // (which scopes context to just it, below).
    const MAX_CHAT_CONTEXT_MEETINGS = 15;
    let contextMeetings = store.getMeetings()
      .filter(m => isAuthorized(req, m))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
      .slice(0, MAX_CHAT_CONTEXT_MEETINGS);

    // When asked from a specific meeting's page (the "Ombeni" button under a
    // recording), scope the model's context down to just that meeting so it
    // answers about that meeting specifically instead of pulling in others.
    if (meetingId) {
      const meeting = store.getMeeting(meetingId);
      if (!meeting) return res.status(404).json({ success: false, error: 'Meeting not found' });
      if (!isAuthorized(req, meeting)) return res.status(403).json({ success: false, error: 'restricted' });
      contextMeetings = [meeting];
    }

    // "What meeting am I having today?" is a calendar question, not a
    // recorded-meetings question — recordings are of things that already
    // happened, so without this the model had nothing to answer from and
    // fell back to a generic "I can't access your calendar" disclaimer.
    let calendarEvents = null;
    const tokens = req.appSession.googleTokens;
    if (tokens && tokens.refresh_token) {
      try {
        const todayRange = dayBounds(0);
        const tomorrowRange = dayBounds(1);
        const [today, tomorrow] = await Promise.all([
          calendarService.listEventsForRange(tokens, todayRange.start, todayRange.end),
          calendarService.listEventsForRange(tokens, tomorrowRange.start, tomorrowRange.end)
        ]);
        calendarEvents = { today, tomorrow };
      } catch (err) {
        console.error('⚠️ Chat calendar fetch failed, continuing without it:', err.message);
      }
    }

    const { reply, sourcesUsed } = await handleChat(messages, {
      meetings: contextMeetings,
      calendarEvents,
      onTaskCreated: ({ task, mondayResult }) => {
        store.logActivity({
          user: req.appSession.user ? req.appSession.user.name : undefined,
          action: `Created task "${task}" via Ask Ombeni`,
          source: 'Monday.com',
          result: mondayResult.created ? 'Success' : 'Pending (Monday.com not connected)'
        });
      }
    });

    const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');
    store.logActivity({
      user: req.appSession.user ? req.appSession.user.name : undefined,
      action: `Asked Ombeni: "${(lastUserMessage && lastUserMessage.content || '').slice(0, 80)}"`,
      source: 'Ombeni AI'
    });

    res.json({ success: true, reply, sourcesUsed });
  } catch (err) {
    store.logActivity({ action: 'Chat request failed', source: 'Ombeni AI', result: 'Error' });
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- Activity log -----------------------------------------------------------

router.get('/activity', requireAdmin, (req, res) => {
  res.json({ success: true, data: store.getActivity() });
});

// --- System instructions (admin only) ---------------------------------------

router.get('/system-instructions', requireAdmin, (req, res) => {
  res.json({ success: true, data: systemInstructions.get() });
});

router.put('/system-instructions', requireAdmin, (req, res) => {
  const data = systemInstructions.set(req.body.body || '', req.appSession.user.name);
  store.logActivity({ user: req.appSession.user.name, action: 'Updated Ombeni AI system instructions', source: 'Settings' });
  res.json({ success: true, data });
});

// --- Monday.com task board (admin only) --------------------------------------

// Lets an admin pick which Monday.com board Ombeni AI creates tasks on —
// both from manual meeting review and from chat — without needing to touch
// MONDAY_BOARD_ID in .env or restart the server.
router.get('/settings/monday-board', requireAdmin, async (req, res) => {
  try {
    const boards = await mondayService.listBoards();
    res.json({ success: true, data: { boardId: mondayService.getBoardId(), boards } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/settings/monday-board', requireAdmin, (req, res) => {
  try {
    const data = settings.setMondayBoardId(req.body.boardId, req.appSession.user.name);
    store.logActivity({ user: req.appSession.user.name, action: `Changed the Monday.com task board (board id ${data.mondayBoardId})`, source: 'Settings' });
    res.json({ success: true, data: { boardId: mondayService.getBoardId() } });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// --- Admin management (admin only) -------------------------------------------

router.get('/admins', requireAdmin, (req, res) => {
  res.json({ success: true, data: admins.list() });
});

router.post('/admins', requireAdmin, (req, res) => {
  try {
    const data = admins.add(req.body.email);
    store.logActivity({ user: req.appSession.user.name, action: `Added admin: ${req.body.email}`, source: 'Settings' });
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.delete('/admins/:email', requireAdmin, (req, res) => {
  try {
    const data = admins.remove(req.params.email);
    store.logActivity({ user: req.appSession.user.name, action: `Removed admin: ${req.params.email}`, source: 'Settings' });
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

module.exports = router;
