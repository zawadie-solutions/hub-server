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
const workActions = require('../services/workActions');
const statementService = require('../services/statementService');
const { extractText, SUPPORTED } = require('../services/fileParser');
const workStore = require('../data/workStore');
const people = require('../data/people');
const admins = require('../data/admins');
const mondayService = require('../services/mondayService');
const mondayAuth = require('../services/mondayAuth');
const { askAboutAssignment } = require('../services/openaiService');
const { mondayUpdateText } = require('../services/statements');

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
        mondayConnected: Boolean(await mondayAuth.tokenFor(email))
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

router.post('/:id/respond', async (req, res) => {
  try {
    const assignment = await ownAssignment(req, res);
    if (!assignment) return;
    const response = String(req.body.response || '');
    if (!workActions.isResponse(response)) return res.status(400).json({ success: false, error: 'Unknown response' });
    res.json({ success: true, data: await workActions.respond(assignment, response, me(req)) });
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
    // They get the statement in Slack too, with its own thread to reply in.
    statementService.notifyOwner(data).then(slack => slack && workStore.saveAssignment({ ...data, slack })).catch(err => console.error('⚠️ Slack DM after taking work failed:', err.message));
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// The person's own Monday access, or a 409 telling the page to offer Connect Monday.
async function myMonday(req, res) {
  const token = await mondayAuth.tokenFor(me(req));
  if (!token) {
    res.status(409).json({ success: false, error: 'Connect your Monday account first (Settings > Your co-worker).', needsMonday: true });
    return null;
  }
  return token;
}

router.get('/boards', async (req, res) => {
  try {
    const token = await myMonday(req, res);
    if (!token) return;
    res.json({ success: true, data: await mondayService.listMyBoards(token) });
  } catch (err) {
    res.status(502).json({ success: false, error: `Couldn't read your Monday boards: ${err.message}` });
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

    const token = await myMonday(req, res);
    if (!token) return;
    // Checked against the boards Monday says they can open, as them.
    const board = (await mondayService.listMyBoards(token)).find(b => b.id === String(req.body.boardId || ''));
    if (!board) return res.status(400).json({ success: false, error: 'Pick one of your own Monday.com boards.' });

    const person = await people.get(me(req));
    const result = await mondayService.createTask({
      token,
      boardId: board.id,
      task: assignment.title,
      ownerUserId: person && person.monday ? person.monday.userId : null,
      due: assignment.statement.due,
      project: assignment.meetingTitle
    });
    if (!result.created) {
      return res.status(502).json({ success: false, error: result.error || 'Monday.com didn\'t accept the task.' });
    }

    // The full statement goes on the item too, so it's there for whoever opens it.
    let statementAdded = true;
    try {
      await mondayService.addUpdate(result.itemId, mondayUpdateText(assignment), token);
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

// ---- Samples: try Ombeni without waiting for a real assignment ----

const SAMPLES_PER_DAY = 3;
const sampling = new Set();

// Builds a [Sample] assignment for the signed-in person only, from their own
// most recent recorded meeting, and sends it to their Slack like a real one,
// so they can try the buttons and thread replies. Their own work from that
// meeting is used if there is any; otherwise the most detailed one.
// Admins only: it's for testing Slack and showing people how Ombeni works, not
// part of everyone's day. The sample is still only ever for the admin asking.
router.post('/sample', async (req, res) => {
  const email = me(req);
  try {
    if (!(await admins.isAdmin(email))) return res.status(403).json({ success: false, error: 'Only Ombeni admins can send samples.' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
  if (sampling.has(email)) return res.status(409).json({ success: false, error: 'A sample is already on its way.' });
  sampling.add(email);
  try {
    // Counted when made, not kept: each one is an AI call, so deleting one
    // doesn't free up another.
    const today = new Date().toISOString().slice(0, 10);
    const person = (await people.get(email)) || {};
    const made = person.samplesMade && person.samplesMade.date === today ? person.samplesMade.count : 0;
    if (made >= SAMPLES_PER_DAY) {
      return res.status(429).json({ success: false, error: `That's ${SAMPLES_PER_DAY} samples today. Try again tomorrow.` });
    }
    const meeting = myMeetings(email)
      .filter(m => (m.transcriptEntries || []).length)
      .sort((a, b) => String(b.startTime || b.date).localeCompare(String(a.startTime || a.date)))[0];
    if (!meeting) return res.status(404).json({ success: false, error: "You don't have a recorded meeting with a transcript yet." });

    let result;
    try {
      result = await statementService.writeStatements(meeting);
    } catch (err) {
      console.error('⚠️ Sample statement failed:', err.message);
      return res.status(502).json({ success: false, error: AI_UNAVAILABLE });
    }
    const detail = (a) => a.statement.mustHaves.length + a.statement.avoid.length;
    const picked = result.assignments.find(a => a.ownerEmail === email)
      || [...result.assignments].sort((a, b) => detail(b) - detail(a))[0];
    if (!picked) return res.status(422).json({ success: false, error: `Ombeni found no clear piece of work in "${meeting.title}" to make a sample from.` });
    await people.update(email, { samplesMade: { date: today, count: made + 1 } });

    let assignment = await workStore.saveAssignment({
      ...picked,
      title: `[Sample] ${picked.title}`.slice(0, 200),
      ownerEmail: email,
      ownerName: myName(req),
      meetingId: meeting.id,
      meetingTitle: meeting.title,
      meetingDate: meeting.date,
      status: 'new',
      declinedBy: [],
      sample: true,
      slack: null,
      monday: null
    });
    const slack = await statementService.notifyOwner(assignment);
    if (slack) assignment = await workStore.saveAssignment({ ...assignment, slack });
    res.json({ success: true, data: assignment });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  } finally {
    sampling.delete(email);
  }
});

// Only samples can be deleted: real work is given back with "Not mine" instead.
router.delete('/:id', async (req, res) => {
  try {
    const assignment = await ownAssignment(req, res);
    if (!assignment) return;
    if (!assignment.sample) return res.status(400).json({ success: false, error: 'Only samples can be deleted. Use "Not mine" to give real work back.' });
    await workStore.deleteAssignment(assignment.id);
    res.json({ success: true, data: null });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
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

    try {
      res.json({ success: true, data: (await workActions.explain(assignment, text)).assignment });
    } catch (err) {
      console.error('⚠️ Explain-it-back check failed:', err.message);
      res.status(502).json({ success: false, error: AI_UNAVAILABLE });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

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

    try {
      res.json({ success: true, data: (await workActions.checkWork(assignment, workText, source)).assignment });
    } catch (err) {
      console.error('⚠️ Work check failed:', err.message);
      res.status(502).json({ success: false, error: AI_UNAVAILABLE });
    }
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
