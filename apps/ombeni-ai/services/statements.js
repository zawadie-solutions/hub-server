// The pure parts of success statements: the prompt that asks the AI for them,
// checking what comes back, and turning them into Slack and Monday text. No
// network calls here (see statementService.js), so it can be tested directly.

const MAX_ITEMS = 12;

function clock(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

function transcriptText(entries) {
  return (entries || []).map(e => `[${clock(e.at)}] ${e.speaker}: ${e.text}`).join('\n');
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * people: [{ name, email }] — the Zawadie people work can be assigned to (the
 * meeting's Zawadie attendees plus the company directory). Only these emails
 * are ever accepted back as an assignee.
 */
function buildPrompt(meeting, people) {
  const weekday = meeting.date ? WEEKDAYS[new Date(`${meeting.date}T12:00:00Z`).getUTCDay()] : '';
  const isClient = meeting.kind === 'client';
  const actionItemHints = ((meeting.analysis && meeting.analysis.actionItems) || [])
    .map(a => `- ${a.task} (owner as noted: ${a.owner || 'none'}${a.due ? `, due ${a.due}` : ''})`)
    .join('\n');

  return `You are reading the transcript of a Zawadie Solutions meeting. Your job is to make sure nobody
forgets or misunderstands the instructions they were given in it.

Find every piece of work that was given to, or taken on by, a specific Zawadie person in this meeting,
and write a success statement for each: what the work must look like for it to count as done right.

Rules:
- An assignment is work a ZAWADIE person has to do. Speakers who are not on the ZAWADIE PEOPLE list
  are outside people (clients, partners). Their own plans for their own business are never assignments.
- One assignment per Zawadie person per piece of work. If two named people share a task, write one
  assignment for each, covering their own part.
- assignee_email must be copied exactly from the ZAWADIE PEOPLE list below, or be null. Never invent
  an email. Names in the transcript are often misspelled by the transcription ("Coco" for "Koko"):
  match when exactly one person on the list clearly fits. Use null when the work went to a team or
  group with no named person ("BAM team", "the AI team"), when it's unclear who took it ("someone
  should...", "we'll look into it"), or when more than one person on the list fits the name used.
- ${isClient
    ? 'Something an outside person promised to do or send FOR ZAWADIE is not an assignment: list it under\n  waiting_on_client.'
    : 'This is an internal meeting: leave waiting_on_client empty.'}
- must_haves are the specific, checkable requirements for this piece of work: numbers, names, dates,
  formats, tools, wording, audiences, limits. Collect every such detail said about this work anywhere
  in the meeting, even minutes later or by someone else. Each one must be something a person could
  tick yes or no.
- Every quote must be copied word for word from ONE transcript line, with that line's speaker and
  [m:ss] time. Never join separate lines with "..." and never reword a quote.
- avoid lists things the person was told not to do, or that were said to be out of scope, with quotes.
- If an instruction was vague (e.g. "make it better", "soon", "the usual format"), do NOT turn it into a
  must_have. Put a short question that would clear it up into unclear.
- due: an exact date in YYYY-MM-DD if one was given or can be worked out from words like "by Friday"
  (the meeting was on ${weekday} ${meeting.date}). Otherwise null. Put the words actually used in due_said.
- outcome: the answer to "What does success look like?": ONE short sentence (at most 25 words) that
  describes the finished work itself when it's a success, naming the concrete qualities that make it
  good, the way a lead would define it. Start with "It" or the deliverable's name. For example, for
  building a voice AI agent: "It completes real tasks end-to-end with accurate tool calls, grounded
  answers, and minimal repeat contacts." Describe the result and what makes it good (who it serves,
  how well it works, what it gets right), not the steps, the schedule or the act of doing the work.
  Only qualities said or clearly implied in this meeting. Never "You've succeeded when...", no
  quotation marks.
- Only use what was said in this meeting. Leave something out rather than guess.
- Write in plain text, no Markdown.

Return strictly valid JSON:
{
  "assignments": [{
    "title": "short task name, max 12 words",
    "assignee_name": "the name used in the meeting",
    "assignee_email": "from the list, or null",
    "assigned_by": "who gave the instruction, or 'self' if they volunteered",
    "outcome": "It ...",
    "must_haves": [{ "text": "...", "quote": "exact words", "speaker": "...", "time": "m:ss" }],
    "avoid": [{ "text": "...", "quote": "exact words", "speaker": "...", "time": "m:ss" }],
    "due": "YYYY-MM-DD or null",
    "due_said": "words used, or null",
    "deliver_to": "who receives the finished work, or null",
    "unclear": ["question to ask before starting"]
  }],
  "waiting_on_client": [{ "who": "...", "what": "...", "quote": "exact words", "time": "m:ss" }]
}

Meeting: ${meeting.title}
Date: ${weekday} ${meeting.date}
Type: ${isClient ? `client meeting (outside attendees from ${meeting.externalDomains.join(', ')})` : 'internal company meeting'}

ZAWADIE PEOPLE (name — email):
${people.map(p => `- ${p.name || '(name unknown)'} — ${p.email}`).join('\n') || '(none)'}

Action items Notetaker noted (hints only; the transcript is the source of truth):
${actionItemHints || '(none)'}

TRANSCRIPT:
${transcriptText(meeting.transcriptEntries)}`;
}

const str = (v, max = 600) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function isoDate(v) {
  const s = str(v, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return isNaN(new Date(`${s}T00:00:00Z`).getTime()) ? null : s;
}

function cleanPoint(p) {
  if (typeof p === 'string') return str(p) ? { text: str(p), quote: '', speaker: '', time: '' } : null;
  if (!p || !str(p.text)) return null;
  return { text: str(p.text), quote: str(p.quote), speaker: str(p.speaker, 120), time: str(p.time, 12) };
}

const list = (v, fn) => (Array.isArray(v) ? v.map(fn).filter(Boolean).slice(0, MAX_ITEMS) : []);

const words = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * A quote is shown as someone's exact words, so it must really be in the
 * transcript. The AI sometimes rewords a quote or splices two lines with
 * "..."; each part has to be found word for word, or the quote is dropped
 * (the requirement itself stays).
 */
function verifiedQuote(quote, transcriptWords) {
  if (!quote || !transcriptWords) return '';
  const parts = quote.split(/\.{3}|…/).map(words).filter(p => p.split(' ').length >= 2);
  if (!parts.length) return '';
  return parts.every(p => transcriptWords.includes(p)) ? quote : '';
}

const DAY_MS = 86400000;
const addDays = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

/**
 * Turns the plain deadlines people say ("tomorrow", "by Friday", "end of the
 * week", "end of the month") into a date, counted from the meeting day. Anything
 * vaguer stays as words.
 */
function resolveDue(said, meetingDate) {
  const s = words(said);
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(meetingDate || '')) return null;
  const meetingDay = new Date(`${meetingDate}T12:00:00Z`).getUTCDay();
  if (/\b(today|tonight|end of (the )?day|eod)\b/.test(s)) return meetingDate;
  if (/\btomorrow\b/.test(s)) return addDays(meetingDate, 1);
  if (/\bend of (the |this )?week\b/.test(s)) return addDays(meetingDate, (5 - meetingDay + 7) % 7);
  if (/\bend of (the |this )?month\b/.test(s)) {
    const d = new Date(`${meetingDate}T12:00:00Z`);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 12)).toISOString().slice(0, 10);
  }
  const named = WEEKDAYS.findIndex(day => new RegExp(`\\b${day.toLowerCase()}\\b`).test(s));
  if (named !== -1 && !/\bweeks?\b/.test(s.replace(new RegExp(WEEKDAYS[named].toLowerCase()), ''))) {
    return addDays(meetingDate, ((named - meetingDay + 7) % 7) || 7); // the next one after the meeting
  }
  return null;
}

/**
 * Checks the AI's answer and keeps only what's usable. An assignee email that
 * isn't one of the allowed Zawadie people is dropped (the work becomes
 * unassigned) rather than trusted: a wrong email would send someone else's
 * instructions to the wrong person. meeting gives the transcript (to check
 * quotes), its kind and its date.
 */
function normalizeStatements(raw, allowedEmails, meeting = {}) {
  const allowed = new Set([...allowedEmails].map(e => e.toLowerCase()));
  const transcriptWords = meeting.transcriptEntries
    ? ` ${(meeting.transcriptEntries || []).map(e => words(e.text)).join(' ')} `
    : null;
  const checkQuote = (p) => (p && transcriptWords !== null ? { ...p, quote: verifiedQuote(p.quote, transcriptWords) } : p);
  const assignments = list(raw && raw.assignments, a => {
    if (!a || !str(a.title)) return null;
    const email = str(a.assignee_email, 191).toLowerCase();
    const dueSaid = str(a.due_said, 120) || null;
    return {
      title: str(a.title, 200),
      ownerEmail: allowed.has(email) ? email : null,
      ownerName: str(a.assignee_name, 120) || null,
      assignedBy: str(a.assigned_by, 120) || null,
      statement: {
        // Shown in quotes, so any the model added are taken off.
        outcome: str(a.outcome).replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim(),
        mustHaves: list(a.must_haves, p => checkQuote(cleanPoint(p))),
        avoid: list(a.avoid, p => checkQuote(cleanPoint(p))),
        due: isoDate(a.due) || resolveDue(dueSaid, meeting.date),
        dueSaid,
        deliverTo: str(a.deliver_to, 160) || null,
        unclear: list(a.unclear, u => str(u) || null)
      }
    };
  });
  // Only a client meeting has a client to wait on.
  const waitingOnClient = meeting.kind === 'company' ? [] : list(raw && raw.waiting_on_client, w => {
    if (!w || !str(w.what)) return null;
    return checkQuote({ who: str(w.who, 120), what: str(w.what), quote: str(w.quote), time: str(w.time, 12) });
  });
  return { assignments, waitingOnClient };
}

// ---- Slack ----

const slackEscape = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// The question every success statement answers, wherever it's shown.
const SUCCESS_HEADING = 'What does success look like?';
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function formatDue(statement) {
  if (statement.due) {
    const d = new Date(`${statement.due}T12:00:00Z`);
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
  }
  return statement.dueSaid || null;
}

/**
 * The DM a person gets for a new assignment: { text, blocks }. interactive:
 * Slack can reach Ombeni, so the buttons work in Slack and replies in the
 * thread are answered; otherwise there's only a link to My Work.
 */
function slackMessage(assignment, link, { interactive = false } = {}) {
  // Short on purpose: the task, what success looks like in one quoted
  // sentence, and when and to whom. The full requirements, with the exact
  // words from the meeting, are one tap away in Ombeni.
  const s = assignment.statement;
  const due = formatDue(s);
  const lines = [];
  if (s.outcome) lines.push(`*${SUCCESS_HEADING}*\n>_"${slackEscape(s.outcome)}"_`);
  const facts = [due ? `*Due:* ${slackEscape(due)}` : null, s.deliverTo ? `*Deliver to:* ${slackEscape(s.deliverTo)}` : null].filter(Boolean);
  if (facts.length) lines.push(facts.join('    '));
  const details = [
    s.mustHaves.length ? plural(s.mustHaves.length, 'must-have') : null,
    s.avoid.length ? plural(s.avoid.length, 'thing', 'things') + ' to avoid' : null,
    s.unclear.length ? plural(s.unclear.length, 'question') + ' to ask before you start' : null
  ].filter(Boolean);

  const heading = `New assignment from ${assignment.meetingTitle}${assignment.meetingDate ? ` (${assignment.meetingDate})` : ''}`;
  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: assignment.title.slice(0, 150) } },
    { type: 'context', elements: [{ type: 'mrkdwn', text: slackEscape(heading) }] },
    // Slack caps a section's text at 3000 characters.
    ...lines.map(text => ({ type: 'section', text: { type: 'mrkdwn', text: text.slice(0, 2900) } })),
    ...(details.length ? [{ type: 'context', elements: [{ type: 'mrkdwn', text: `In Ombeni: ${details.join(' · ')}, with the exact words from the meeting.` }] }] : []),
    { type: 'divider' },
    ...(interactive ? [
      {
        type: 'actions',
        block_id: 'ombeni_assignment',
        elements: [
          { type: 'button', action_id: 'ombeni_got_it', value: assignment.id, text: { type: 'plain_text', text: 'Got it' }, style: 'primary' },
          {
            type: 'button', action_id: 'ombeni_not_mine', value: assignment.id, text: { type: 'plain_text', text: 'Not mine' },
            confirm: {
              title: { type: 'plain_text', text: 'Give this back?' },
              text: { type: 'plain_text', text: 'It goes to the other Zawadie people from that meeting, so one of them can take it.' },
              confirm: { type: 'plain_text', text: 'Give it back' },
              deny: { type: 'plain_text', text: 'Keep it' }
            }
          },
          { type: 'button', action_id: 'ombeni_open', text: { type: 'plain_text', text: 'Open in Ombeni' }, url: link }
        ]
      },
      { type: 'context', elements: [{ type: 'mrkdwn', text: '*Reply in this thread:* say in your own words what you\'ll deliver and I\'ll check you\'ve got it all  ·  end with *?* to ask about it  ·  attach your draft or a screenshot to check it before you deliver.' }] }
    ] : [
      {
        type: 'actions',
        elements: [{ type: 'button', text: { type: 'plain_text', text: 'Open in Ombeni' }, url: link, style: 'primary' }]
      },
      { type: 'context', elements: [{ type: 'mrkdwn', text: 'In Ombeni, tap *Got it* once you\'ve read this, or *Not mine* if it isn\'t your work.' }] }
    ])
  ];
  return { text: `${assignment.title}: ${heading}`, blocks };
}

// ---- Monday ----

/** The success statement as plain text, added to the Monday item as an update. */
function mondayUpdateText(assignment) {
  const s = assignment.statement;
  const quote = (p) => (p.quote ? ` ("${p.quote}"${p.speaker ? ` (${p.speaker}${p.time ? `, ${p.time}` : ''})` : ''})` : '');
  const parts = [`Success statement from ${assignment.meetingTitle} (${assignment.meetingDate || ''})`];
  if (s.outcome) parts.push(`${SUCCESS_HEADING}\n"${s.outcome}"`);
  if (s.mustHaves.length) parts.push(`Must have:\n${s.mustHaves.map(p => `- ${p.text}${quote(p)}`).join('\n')}`);
  if (s.avoid.length) parts.push(`Avoid:\n${s.avoid.map(p => `- ${p.text}${quote(p)}`).join('\n')}`);
  const due = formatDue(s);
  if (due) parts.push(`Due: ${due}`);
  if (s.deliverTo) parts.push(`Deliver to: ${s.deliverTo}`);
  if (s.unclear.length) parts.push(`Still unclear:\n${s.unclear.map(u => `- ${u}`).join('\n')}`);
  return parts.join('\n\n');
}

module.exports = { buildPrompt, normalizeStatements, resolveDue, slackMessage, mondayUpdateText, transcriptText, clock };
