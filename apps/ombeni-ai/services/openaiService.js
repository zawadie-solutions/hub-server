const OpenAI = require('openai');
const env = require('../config/env');
const knowledgeStore = require('../data/knowledgeStore');
const systemInstructions = require('../data/systemInstructions');
const mondayService = require('../services/mondayService');
const { transcriptText, mondayUpdateText } = require('./statements');

const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
const MODEL = 'gpt-4o';

const OMBENI_IDENTITY = `You are Ombeni AI, the internal company AI assistant for Zawadie Solutions.
You have access to: (1) Zawadie's company knowledge base, (2) transcripts and summaries of the company's
recorded meetings, (3) the ability to reference Monday.com tasks and Slack activity when that context
is provided to you, and (4) the ability to create new tasks directly on Zawadie's Monday.com board via
the create_monday_task tool. You help employees at every level get answers, recommendations, and status
updates across all of this.

Whenever someone asks you to add, create, log, or file a task / to-do / action item (e.g. "add a task to
follow up with the client", "create a Monday task for Tyler due Friday"), call create_monday_task rather
than just describing what you would do — pull the task description, and owner/due date/priority if they're
mentioned, straight from their message. Confirm briefly once it's done, or explain plainly if it failed
(e.g. Monday.com isn't connected).

When someone asks you to draft or write an email (a follow-up, a recap, a reply) and the draft_email tool is
available, call it: it saves a draft in their own Gmail, it never sends. Then tell them it's in their Gmail
drafts, include the link, and remind them to review it before sending. If the tool isn't available, write the
email in your reply and say they can allow Gmail drafts from a meeting page or Settings.

Follow Zawadie's knowledge base rules strictly:
- Treat the knowledge base as the primary source of truth about the company.
- Never invent customers, partnerships, pricing, revenue, employee counts, locations, or results that
  aren't in the knowledge base or the meeting context you're given.
- Clearly distinguish verified information from strategic direction (things Zawadie intends to do but
  hasn't done yet).
- If something isn't covered by the knowledge base or the meetings you were given, say so plainly instead
  of guessing.
- Be professional, direct, practical, and specific — avoid hype and generic marketing language.
- When you reference a meeting, name it so the person knows where the information came from.

Write in plain conversational prose — this chat window displays your reply as plain text, not
rendered Markdown, so any Markdown syntax you write shows up literally as stray symbols on screen:
asterisks show as literal asterisks, not bold, and a bolded phrase ending in a colon shows up
wrapped in stray quote marks too. So specifically:
- Never wrap any word or phrase in a pair of asterisks, for any reason — not for emphasis, and
  never as a bolded label at the start of a list item or line (no "**Review Key Objectives:**").
  A step in a list is just plain text: "Review key objectives: the goal of these meetings is..."
  with no symbols around "Review key objectives".
- Never use # headings or backtick code formatting either.
- For a numbered or step-by-step answer, write "1. ... 2. ..." or "First, ... Then, ..." as plain
  text — not markdown list syntax, and no bolded lead-in label on any step.
- Don't wrap meeting titles, project names, or ordinary terms in quotation marks just for
  emphasis (e.g. write the AI Integration Huddle, not "AI Integration Huddle"). Reserve quotation
  marks for when you're quoting someone's actual words from a transcript.

CRITICAL — do not confuse this with "real-time" or "current events" questions:
When a user references a meeting using recency language ("just now", "this morning", "today",
"recently", "just finished"), that is NOT a request for live internet access or current events.
Both sections below were fetched fresh right before this conversation, specifically so you could
answer questions like this:
- RECORDED MEETINGS is meetings that have already happened and been recorded/transcribed.
- UPCOMING CALENDAR EVENTS is what's scheduled on the user's calendar today and tomorrow —
  this is where "what meeting am I having today?" or "what's next on my calendar?" is answered
  from, NOT from RECORDED MEETINGS (a meeting that hasn't happened yet won't be there).
Before concluding you lack information, check the section relevant to what's being asked. If you
find a match, just answer from it directly and normally — do not open with any version of "I
don't have information on a meeting that just happened/today/recently" before then reversing
yourself and giving the answer anyway. That hedge is confusing and unnecessary when the meeting
is right there in your context; if you have it, lead with the answer, full stop. Only say you
don't have the information if, after checking the relevant section, nothing matches — and even
then, say plainly that nothing matching is in your recorded meetings or calendar (whichever was
relevant), never a generic "I don't have real-time access" or "my knowledge has a cutoff date"
disclaimer — those don't apply here; you are not being asked about the outside world, only about
the specific dated context you were handed below.`;

// Un-analyzed meetings fall back to their raw transcript, which for a real
// Notetaker recording can run to tens of thousands of characters — enough on
// its own to blow past OpenAI's per-minute token limit for a single chat
// request. Cap it so one long, un-summarized meeting can't crowd out
// everything else in the context.
const MAX_RAW_TRANSCRIPT_CHARS = 4000;

function meetingsContext(meetings) {
  return meetings.map(m => {
    const lines = [`### Meeting: ${m.title} (${m.date})`, `Project: ${m.project || 'N/A'}`, `Participants: ${(m.participants || []).join(', ')}`];
    if (m.analysis) {
      lines.push(`Summary: ${m.analysis.summary}`);
      if (m.analysis.decisions && m.analysis.decisions.length) {
        lines.push(`Decisions: ${m.analysis.decisions.join(' | ')}`);
      }
      if (m.analysis.actionItems && m.analysis.actionItems.length) {
        lines.push(`Action items: ${m.analysis.actionItems.map(a => `${a.task} (owner: ${a.owner}, due: ${a.due || 'n/a'})`).join(' | ')}`);
      }
      if (m.analysis.unresolved && m.analysis.unresolved.length) {
        lines.push(`Unresolved: ${m.analysis.unresolved.join(' | ')}`);
      }
    } else {
      const transcript = m.transcript || '';
      const truncated = transcript.length > MAX_RAW_TRANSCRIPT_CHARS
        ? `${transcript.slice(0, MAX_RAW_TRANSCRIPT_CHARS)}\n[...transcript truncated — analyze this meeting for the full picture...]`
        : transcript;
      lines.push(`Raw transcript (not yet AI-summarized): ${truncated}`);
    }
    return lines.join('\n');
  }).join('\n\n');
}

/**
 * Analyze a single meeting transcript into a structured summary.
 */
async function processMeetingAnalysis(meeting) {
  const prompt = `Analyze this meeting transcript for Zawadie Solutions and return strictly valid JSON with this shape:
{
  "summary": "2-3 sentence executive summary",
  "keyPoints": ["short discussion point", ...],
  "decisions": ["decision made", ...],
  "actionItems": [{ "task": "...", "owner": "...", "due": "...", "priority": "High|Medium|Low" }],
  "unresolved": ["open question", ...]
}

Meeting: ${meeting.title}
Date: ${meeting.date}
Participants: ${(meeting.participants || []).join(', ')}
Transcript:
${meeting.transcript}`;

  const response = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: OMBENI_IDENTITY },
      { role: 'user', content: prompt }
    ],
    response_format: { type: 'json_object' }
  });

  return JSON.parse(response.choices[0].message.content);
}

function calendarContext(calendarEvents) {
  if (!calendarEvents || (calendarEvents.today.length === 0 && calendarEvents.tomorrow.length === 0)) {
    return 'No calendar access, or nothing scheduled today or tomorrow.';
  }
  const formatEvent = (e) => `- ${e.title} (${e.isAllDay ? 'all day' : new Date(e.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}${e.attendees && e.attendees.length ? `, attendees: ${e.attendees.join(', ')}` : ''})`;
  const lines = [];
  lines.push(`Today (${calendarEvents.today.length}):`);
  lines.push(calendarEvents.today.length ? calendarEvents.today.map(formatEvent).join('\n') : '(nothing scheduled today)');
  lines.push(`Tomorrow (${calendarEvents.tomorrow.length}):`);
  lines.push(calendarEvents.tomorrow.length ? calendarEvents.tomorrow.map(formatEvent).join('\n') : '(nothing scheduled tomorrow)');
  return lines.join('\n');
}

const CHAT_TOOLS = [{
  type: 'function',
  function: {
    name: 'create_monday_task',
    description: 'Creates a new task/action item on Zawadie\'s configured Monday.com board. Call this any time the user asks you to add, create, log, or file a task, to-do, or action item.',
    parameters: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'The task description.' },
        owner: { type: 'string', description: "The person's name to assign the task to, if one was mentioned." },
        due: { type: 'string', description: 'Due date in YYYY-MM-DD format, if one was mentioned.' },
        priority: { type: 'string', enum: ['High', 'Medium', 'Low'], description: 'Priority, if mentioned or implied.' },
        project: { type: 'string', description: 'Project or context name, if one was mentioned.' }
      },
      required: ['task']
    }
  }
}];

// Only offered to people who allowed Gmail drafts. Creates a DRAFT in their
// own Gmail; nothing is ever sent.
const DRAFT_EMAIL_TOOL = {
  type: 'function',
  function: {
    name: 'draft_email',
    description: "Saves an email as a DRAFT in the user's own Gmail for them to review and send. Never sends. Use when the user asks you to draft, write or prepare an email, follow-up or recap.",
    parameters: {
      type: 'object',
      properties: {
        to: { type: 'array', items: { type: 'string' }, description: 'Recipient email addresses: ones the user gave, or attendee emails from the meeting they mean. Empty if unknown.' },
        subject: { type: 'string' },
        body: { type: 'string', description: 'Plain-text email body, signed with the user\'s first name. Only facts from the meetings and knowledge base.' }
      },
      required: ['subject', 'body']
    }
  }
};

async function runTool(call, { onTaskCreated, taskBoardId, draftEmail }) {
  if (call.function.name === 'draft_email' && draftEmail) {
    let args;
    try {
      args = JSON.parse(call.function.arguments || '{}');
    } catch {
      return { success: false, message: 'Could not parse tool arguments' };
    }
    const result = await draftEmail(args);
    return result.created
      ? { success: true, message: `Draft saved in the user's Gmail (not sent). Link for the user: ${result.link}` }
      : { success: false, message: `Couldn't save the draft: ${result.reason}` };
  }
  if (call.function.name !== 'create_monday_task') {
    return { success: false, message: 'Unknown tool' };
  }

  let args;
  try {
    args = JSON.parse(call.function.arguments || '{}');
  } catch {
    return { success: false, message: 'Could not parse tool arguments' };
  }

  // Set here rather than taken from the model's arguments, so what's said in a
  // chat can't send a task to a board the person didn't choose.
  const mondayResult = await mondayService.createTask({ ...args, boardId: taskBoardId });
  if (onTaskCreated) onTaskCreated({ ...args, mondayResult });

  if (mondayResult.created) {
    return { success: true, message: `Task "${args.task}" was created in Monday.com.` };
  }
  const reason = mondayResult.reason === 'not_configured'
    ? "Monday.com isn't connected yet."
    : (mondayResult.error || 'Unknown error.');
  return { success: false, message: `Couldn't create the task in Monday.com: ${reason}` };
}

/**
 * General-purpose chat grounded in the Zawadie knowledge base, every recorded
 * meeting, and (when available) the user's calendar for today/tomorrow. Can
 * also create Monday.com tasks on request via the create_monday_task tool —
 * onTaskCreated, if given, is called once per task actually created (so the
 * caller can log it to the activity feed). taskBoardId, if given, is the board
 * those tasks go to (an admin's own); otherwise they use the shared one.
 * Returns { reply, sourcesUsed } where sourcesUsed lists which meetings were relevant.
 */
async function handleChat(messages, { meetings = [], calendarEvents = null, onTaskCreated = null, taskBoardId = null, draftEmail = null } = {}) {
  const tools = draftEmail ? [...CHAT_TOOLS, DRAFT_EMAIL_TOOL] : CHAT_TOOLS;
  const customInstructions = systemInstructions.get().body.trim();
  const customBlock = customInstructions
    ? `\n\n=== ADDITIONAL INSTRUCTIONS FROM ZAWADIE LEADERSHIP ===\nThese refine your tone, behavior, and response format — follow them directly. They do not authorize inventing facts that aren't in the knowledge base or meetings below.\n${customInstructions}`
    : '';

  const systemMessage = {
    role: 'system',
    content: `${OMBENI_IDENTITY}${customBlock}

=== ZAWADIE COMPANY KNOWLEDGE BASE ===
${knowledgeStore.combinedText()}

=== UPCOMING CALENDAR EVENTS ===
${calendarContext(calendarEvents)}

=== RECORDED MEETINGS ===
${meetingsContext(meetings)}`
  };

  const conversation = [systemMessage, ...messages];
  let response = await openai.chat.completions.create({
    model: MODEL,
    messages: conversation,
    tools
  });
  let choice = response.choices[0];

  // A tool call isn't the final answer — run it, feed the result back, and
  // ask the model again for the reply that actually goes to the user. Looped
  // (not just once) in case a single request names more than one task.
  while (choice.finish_reason === 'tool_calls' && choice.message.tool_calls) {
    conversation.push(choice.message);
    for (const call of choice.message.tool_calls) {
      const result = await runTool(call, { onTaskCreated, taskBoardId, draftEmail });
      conversation.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
    }
    response = await openai.chat.completions.create({
      model: MODEL,
      messages: conversation,
      tools
    });
    choice = response.choices[0];
  }

  const reply = choice.message.content;

  // Lightweight deterministic "sources" hint for the UI: which meetings this
  // reply plausibly drew on, based on whether their title/keywords show up.
  const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');
  const haystack = `${lastUserMessage ? lastUserMessage.content : ''} ${reply}`.toLowerCase();
  const sourcesUsed = meetings
    .filter(m => haystack.includes(m.title.toLowerCase()) || haystack.includes(m.id.toLowerCase()))
    .map(m => ({ type: 'meeting', id: m.id, title: m.title }));

  return { reply, sourcesUsed };
}

// Long enough for any real meeting seen so far (the longest was ~40k characters).
const MAX_ASSIGNMENT_TRANSCRIPT_CHARS = 80000;

/**
 * Answers the assigned person's questions about one assignment, from the
 * meeting it came from. Kept to that assignment: the person may not have
 * attended the meeting, so this isn't a way into the rest of it.
 */
async function askAboutAssignment(assignment, meeting, messages) {
  const transcript = meeting && meeting.transcriptEntries && meeting.transcriptEntries.length
    ? transcriptText(meeting.transcriptEntries).slice(0, MAX_ASSIGNMENT_TRANSCRIPT_CHARS)
    : '(The transcript is no longer available. Answer from the success statement only, and say so.)';

  const system = `You are Ombeni AI, Zawadie Solutions' assistant. You are helping ${assignment.ownerName || 'a Zawadie employee'} get
one assignment exactly right. The assignment came from the meeting "${assignment.meetingTitle}" (${assignment.meetingDate}).

Answer only questions about this assignment: what was asked, the exact words used, details, deadlines,
who to deliver to, and what is still unclear. If they ask about other parts of the meeting that have
nothing to do with this assignment, say you can only help with their assignment here.

When the transcript answers the question, quote the exact words with the speaker and [m:ss] time.
When it doesn't, say so plainly and suggest asking ${assignment.assignedBy && assignment.assignedBy !== 'self' ? assignment.assignedBy : 'whoever gave the instruction'}.
Never guess. Write plain text, no Markdown symbols.

THE ASSIGNMENT (success statement):
${mondayUpdateText(assignment)}

MEETING TRANSCRIPT:
${transcript}`;

  const response = await openai.chat.completions.create({
    model: MODEL,
    temperature: 0.2,
    messages: [{ role: 'system', content: system }, ...messages]
  });
  return response.choices[0].message.content;
}

/**
 * A recap email to the client after a client meeting: what we understood,
 * what we'll deliver, what we need from them, and what to confirm. Written
 * only from the meeting itself. Returns { subject, body }.
 */
async function writeRecapEmail(meeting, { senderName, waitingOnClient = [] }) {
  const transcript = transcriptText(meeting.transcriptEntries || []).slice(0, MAX_ASSIGNMENT_TRANSCRIPT_CHARS);
  const a = meeting.analysis || {};
  const response = await openai.chat.completions.create({
    model: MODEL,
    temperature: 0.3,
    response_format: { type: 'json_object' },
    messages: [{
      role: 'user',
      content: `Write a short recap email from ${senderName || 'a Zawadie Solutions team member'} at Zawadie Solutions to the client
after the meeting "${meeting.title}" (${meeting.date}). Its purpose is to confirm in writing that we understood
them correctly, so nothing gets lost or misunderstood.

Structure (plain text, short paragraphs and simple "- " lists, under 250 words, warm and professional):
1. Thank them briefly.
2. "What we understood": their specific requirements, with the exact numbers, dates, formats and names they gave.
3. "What we'll deliver, and when": only what Zawadie actually committed to in the meeting.
4. "What we need from you": what they said they would send or do.
5. "Please confirm": anything left vague or open, as short questions.
6. Sign off with the sender's first name.
Never invent commitments, prices or dates that weren't said. Leave a section out if it would be empty.
This is a plain-text email: no Markdown, no asterisks, no # headings. Write section titles as plain lines.
Refer to the meeting by its date (${meeting.date}), never "yesterday" or "today": it may be sent days later.

Return JSON: { "subject": "...", "body": "..." }

MEETING SUMMARY: ${a.summary || '(none)'}
CLIENT PROMISED: ${waitingOnClient.map(w => `${w.who}: ${w.what}`).join(' | ') || '(nothing recorded)'}

TRANSCRIPT:
${transcript || '(no transcript; use the summary)'}

${a.fullSummary ? `NOTES:\n${String(a.fullSummary).slice(0, 4000)}` : ''}`
    }]
  });
  const raw = JSON.parse(response.choices[0].message.content);
  return {
    subject: String(raw.subject || `Recap: ${meeting.title}`).slice(0, 200),
    // In case Markdown slips through: it would show as literal symbols in a plain-text email.
    body: String(raw.body || '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/^#+\s*/gm, '').slice(0, 8000)
  };
}

module.exports = { processMeetingAnalysis, handleChat, askAboutAssignment, writeRecapEmail };
