// My Work: each person's own success statements. Everything here is private to
// the person it belongs to. There is no admin or manager view, and no admin
// override on any of these checks.
//
//   - Your assignments: only their owner can see or act on them.
//   - Unassigned work: visible to the people who attended that meeting (they
//     already see the whole meeting), so one of them can take it.
//   - Waiting on the client: also only for that meeting's attendees.
const express = require('express');
const multer = require('multer');
const store = require('../data/store');
const checkService = require('../services/checkService');
const { extractText, SUPPORTED } = require('../services/fileParser');
const workStore = require('../data/workStore');
const mondayService = require('../services/mondayService');
const { askAboutAssignment } = require('../services/openaiService');
const { mondayUpdateText } = require('../services/statements');
const env = require('../config/env');

const router = express.Router();

const me = (req) => (req.appSession.user ? req.appSession.user.email.toLowerCase() : null);
const myName = (req) => (req.appSession.user ? req.appSession.user.name : null);

function myMeetings(email) {
  return store.getMeetings().filter(m => (m.participants || []).length && store.isAuthorizedForMeeting(m, email));
}

const byNewest = (a, b) => String(b.meetingDate || '').localeCompare(String(a.meetingDate || '')) || String(b.createdAt).localeCompare(String(a.createdAt));

router.use((req, res, next) => {
  if (!me(req)) return res.status(401).json({ success: false, error: 'Sign in through the Zawadie Hub to see your work.' });
  next();
});

router.get('/', async (req, res) => {
  try {
    const email = me(req);
    const meetings = myMeetings(email);
    const meetingIds = meetings.map(m => m.id);
    const titles = new Map(meetings.map(m => [m.id, m]));

    const [mine, unassigned, briefs] = await Promise.all([
      workStore.assignmentsForOwner(email),
      workStore.unassignedForMeetings(meetingIds),
      workStore.getBriefs(meetingIds)
    ]);

    const waitingOnClient = briefs
      .filter(b => b.status === 'done' && (b.waitingOnClient || []).length)
      .map(b => ({
        meetingId: b.meetingId,
        meetingTitle: titles.get(b.meetingId).title,
        meetingDate: titles.get(b.meetingId).date,
        clients: b.externalDomains || [],
        items: b.waitingOnClient
      }))
      .sort(byNewest);

    res.json({
      success: true,
      data: {
        mine: mine.sort(byNewest),
        unassigned: unassigned.sort(byNewest),
        waitingOnClient,
        mondayConnected: Boolean(env.MONDAY_API_KEY)
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Loads an assignment and checks it belongs to the signed-in person.
async function ownAssignment(req, res) {
  const assignment = await workStore.getAssignment(req.params.id);
  if (!assignment || assignment.ownerEmail !== me(req)) {
    res.status(404).json({ success: false, error: 'That assignment isn\'t yours, or no longer exists.' });
    return null;
  }
  return assignment;
}

const RESPONSES = {
  got_it: (a) => ({ ...a, status: 'confirmed', confirmedAt: new Date().toISOString() }),
  done: (a) => ({ ...a, status: 'done', doneAt: new Date().toISOString() }),
  reopen: (a) => ({ ...a, status: 'confirmed', doneAt: null })
};

router.post('/:id/respond', async (req, res) => {
  try {
    const assignment = await ownAssignment(req, res);
    if (!assignment) return;
    const response = String(req.body.response || '');

    if (response === 'not_mine') {
      // Back to the meeting's attendees, who can take it.
      const declinedBy = [...new Set([...(assignment.declinedBy || []), me(req)])];
      // Their own explanation and checks stay private: they don't pass on with the work.
      await workStore.saveAssignment({ ...assignment, ownerEmail: null, status: 'new', declinedBy, slack: null, explained: null, checks: [] });
      return res.json({ success: true, data: null });
    }
    if (!RESPONSES[response]) return res.status(400).json({ success: false, error: 'Unknown response' });
    res.json({ success: true, data: await workStore.saveAssignment(RESPONSES[response](assignment)) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/:id/claim', async (req, res) => {
  try {
    const assignment = await workStore.getAssignment(req.params.id);
    const meeting = assignment && store.getMeeting(assignment.meetingId);
    if (!assignment || !meeting || !store.isAuthorizedForMeeting(meeting, me(req)) || !(meeting.participants || []).length) {
      return res.status(404).json({ success: false, error: 'That work isn\'t available to you.' });
    }
    if (assignment.ownerEmail) return res.status(409).json({ success: false, error: 'Someone has already taken this.' });
    const data = await workStore.saveAssignment({
      ...assignment,
      ownerEmail: me(req),
      ownerName: myName(req),
      slack: null, // any earlier message went to someone else
      explained: null,
      checks: [],
      status: 'confirmed',
      confirmedAt: new Date().toISOString()
    });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/boards', async (req, res) => {
  try {
    res.json({ success: true, data: await mondayService.listBoardsFor(me(req)) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// One send at a time per assignment, so a double click can't make two items.
const sending = new Set();

router.post('/:id/monday', async (req, res) => {
  const id = req.params.id;
  if (sending.has(id)) return res.status(409).json({ success: false, error: 'Already sending this one.' });
  sending.add(id);
  try {
    const assignment = await ownAssignment(req, res);
    if (!assignment) return;
    if (assignment.monday) return res.status(409).json({ success: false, error: 'This is already on Monday.com.' });

    const board = (await mondayService.listBoardsFor(me(req))).find(b => b.id === String(req.body.boardId || ''));
    if (!board) return res.status(400).json({ success: false, error: 'Pick one of your own Monday.com boards.' });

    const result = await mondayService.createTask({
      task: assignment.title,
      owner: myName(req),
      ownerEmail: me(req),
      due: assignment.statement.due,
      project: assignment.meetingTitle,
      boardId: board.id
    });
    if (!result.created) {
      return res.status(502).json({ success: false, error: result.error || 'Monday.com didn\'t accept the task.' });
    }

    // The full statement goes on the item too, so it's there for whoever opens it.
    let statementAdded = true;
    try {
      await mondayService.addUpdate(result.itemId, mondayUpdateText(assignment));
    } catch (err) {
      statementAdded = false;
      console.error('⚠️ Could not add the success statement to the Monday item:', err.message);
    }

    const data = await workStore.saveAssignment({
      ...assignment,
      monday: { boardId: board.id, boardName: board.name, itemId: result.itemId, statementAdded, sentAt: new Date().toISOString() }
    });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  } finally {
    sending.delete(id);
  }
});

// ---- Phase 2: making sure the work is understood, and delivered right ----

const AI_UNAVAILABLE = 'Ombeni couldn\'t check this just now. Try again in a minute.';

// Explain it back: the person says in their own words what they'll deliver,
// and Ombeni points out anything missed or different from what was asked.
// When nothing is, that counts as "Got it".
router.post('/:id/explain', async (req, res) => {
  try {
    const assignment = await ownAssignment(req, res);
    if (!assignment) return;
    const text = String(req.body.text || '').trim();
    if (text.length < 15) return res.status(400).json({ success: false, error: 'Write a sentence or two about what you\'re going to deliver.' });

    let result;
    try {
      result = await checkService.checkExplanation(assignment, text);
    } catch (err) {
      console.error('⚠️ Explain-it-back check failed:', err.message);
      return res.status(502).json({ success: false, error: AI_UNAVAILABLE });
    }

    const now = new Date().toISOString();
    const confirmed = result.ready && assignment.status === 'new';
    const data = await workStore.saveAssignment({
      ...assignment,
      explained: { text: text.slice(0, 4000), result, at: now },
      ...(confirmed ? { status: 'confirmed', confirmedAt: now } : {})
    });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
const KEEP_CHECKS = 5;

// Check my work: a draft (file or pasted text) or a description of what they
// did, checked against every requirement before it's delivered. Only the
// result is kept, never the work itself.
router.post('/:id/check', upload.single('file'), async (req, res) => {
  try {
    const assignment = await ownAssignment(req, res);
    if (!assignment) return;

    let workText = String(req.body.text || '').trim();
    let source = 'What you wrote';
    if (req.file) {
      try {
        workText = await extractText(req.file);
      } catch (err) {
        return res.status(400).json({ success: false, error: `Couldn't read that file. Use one of: ${SUPPORTED.join(', ')}.` });
      }
      source = req.file.originalname;
    }
    if (!workText) return res.status(400).json({ success: false, error: 'Add your draft, or describe what you did.' });

    let result;
    try {
      result = await checkService.checkWork(assignment, workText);
    } catch (err) {
      console.error('⚠️ Work check failed:', err.message);
      return res.status(502).json({ success: false, error: AI_UNAVAILABLE });
    }

    const check = { at: new Date().toISOString(), source: source.slice(0, 200), result };
    const data = await workStore.saveAssignment({
      ...assignment,
      checks: [check, ...(assignment.checks || [])].slice(0, KEEP_CHECKS)
    });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/:id/ask', async (req, res) => {
  try {
    const assignment = await ownAssignment(req, res);
    if (!assignment) return;
    const messages = Array.isArray(req.body.messages) ? req.body.messages.slice(-12) : [];
    if (!messages.length) return res.status(400).json({ success: false, error: 'Ask a question first.' });
    const meeting = store.getMeeting(assignment.meetingId);
    const reply = await askAboutAssignment(assignment, meeting, messages.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content || '').slice(0, 4000)
    })));
    res.json({ success: true, reply });
  } catch (err) {
    console.error('⚠️ Ask about an assignment failed:', err.message);
    res.status(502).json({ success: false, error: 'Ombeni couldn\'t answer just now. Try again in a minute.' });
  }
});

module.exports = router;
