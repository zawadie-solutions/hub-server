// The pure parts of Phase 2: checking a person's understanding of an
// assignment ("explain it back") and checking their work against it before
// they deliver. Prompts and result clean-up only; the OpenAI calls are in
// checkService.js.

const MAX_WORK_CHARS = 60000;

const words = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const str = (v, max = 600) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function formatDue(statement) {
  if (statement.due) {
    return new Date(`${statement.due}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
  }
  return statement.dueSaid || null;
}

/**
 * The success statement as a numbered list of requirements (R1, R2, ...), so
 * every one of them gets its own verdict. The due date and who to deliver to
 * only matter for explaining it back: a draft can't show either.
 */
function requirementsFor(assignment, { forWork = false } = {}) {
  const s = assignment.statement;
  const list = [];
  if (s.outcome) list.push({ kind: 'outcome', text: s.outcome });
  for (const p of s.mustHaves) list.push({ kind: 'must', text: p.text, quote: p.quote });
  for (const p of s.avoid) list.push({ kind: 'avoid', text: p.text, quote: p.quote });
  if (!forWork) {
    const due = formatDue(s);
    if (due) list.push({ kind: 'due', text: `Due ${due}${s.dueSaid ? ` (said as "${s.dueSaid}")` : ''}` });
    if (s.deliverTo) list.push({ kind: 'deliver', text: `Goes to ${s.deliverTo}` });
  }
  return list.map((r, i) => ({ id: `R${i + 1}`, ...r }));
}

const KIND_LABEL = { outcome: 'Overall goal', must: 'Must have', avoid: 'Must NOT do', due: 'Deadline', deliver: 'Deliver to' };

function requirementLines(reqs) {
  return reqs.map(r => `${r.id} [${KIND_LABEL[r.kind]}] ${r.text}${r.quote ? `  (said in the meeting: "${r.quote}")` : ''}`).join('\n');
}

// ---- Explain it back ----

function explainPrompt(assignment, explanation) {
  const reqs = requirementsFor(assignment);
  return `A Zawadie employee was given this work in the meeting "${assignment.meetingTitle}". Before starting,
they explained back, in their own words, what they are going to deliver. Your job is to catch
misunderstandings now, not after the work is done.

For each requirement below, compare it with their explanation:
- For "Must NOT do" requirements: status "ok" unless their explanation says they will do that thing,
  then "conflict".
- For every other requirement: "covered" if their explanation includes it (their own wording is fine),
  "missed" if they didn't mention it, "different" if they said something that doesn't match it
  (another number, format, person, date, scope...).
- Judge meaning, not wording: "end of November" and "November 30" are the same deadline; "Tyler" and
  "Tyler Clark" are the same person. Only mark "different" when it would lead to different work.
- note: one short sentence written TO the person, using "you" (e.g. "You said mid December, but it's
  due Monday, November 30."). For "different", say what they said and what was asked. For "missed",
  say what they left out. Empty for "covered" and "ok".

Also list in "extra" anything they plan to do that wasn't asked for and could waste their time or
clash with what was asked. Leave it empty otherwise. Don't be picky about wording.

Return strictly valid JSON:
{ "items": [{ "id": "R1", "status": "...", "note": "..." }], "extra": ["..."] }

REQUIREMENTS:
${requirementLines(reqs)}

THEIR EXPLANATION:
${str(explanation, 4000)}`;
}

const EXPLAIN_STATUSES = { avoid: ['ok', 'conflict'], other: ['covered', 'missed', 'different'] };

/**
 * Every requirement gets a verdict, whatever the AI returned. One it skipped
 * counts as missed (or as fine, for a "must not do"), so a gap is never
 * hidden by a short answer. Ready means nothing missed, different or in conflict.
 */
function normalizeExplain(raw, assignment) {
  const reqs = requirementsFor(assignment);
  const byId = new Map((Array.isArray(raw && raw.items) ? raw.items : []).filter(i => i && i.id).map(i => [String(i.id).trim(), i]));
  const items = reqs.map(r => {
    const allowed = r.kind === 'avoid' ? EXPLAIN_STATUSES.avoid : EXPLAIN_STATUSES.other;
    const got = byId.get(r.id) || {};
    const status = allowed.includes(got.status) ? got.status : (r.kind === 'avoid' ? 'ok' : 'missed');
    const note = status === 'covered' || status === 'ok' ? '' : (str(got.note, 400) || (status === 'missed' ? 'You didn\'t mention this.' : ''));
    return { id: r.id, kind: r.kind, text: r.text, status, note };
  });
  const extra = (Array.isArray(raw && raw.extra) ? raw.extra : []).map(e => str(e, 300)).filter(Boolean).slice(0, 5);
  const ready = items.every(i => i.status === 'covered' || i.status === 'ok');
  return { items, extra, ready };
}

// ---- Check my work ----

function workPrompt(assignment, workText) {
  const reqs = requirementsFor(assignment, { forWork: true });
  return `A Zawadie employee is about to deliver this work, from the meeting "${assignment.meetingTitle}". Check it
against what was asked, requirement by requirement, before it goes out. What they gave you is either
the work itself (a document) or their description of what they did.

For each requirement:
- "Must NOT do" requirements: "met" if the work respects it, "not_met" if the work does that thing.
- Every other requirement: "met" if the work clearly satisfies it, "not_met" if it clearly doesn't or
  it's missing, "unclear" if you can't tell from what you were given.
- evidence: the exact words from THE WORK that show it (copy them word for word, short), or "" if none.
- fix: for "not_met" or "unclear", one short, specific sentence written TO the person ("Add ...",
  "Your draft doesn't show ..."). "" for "met".
Judge only from the work below. Never assume something was done.

Return strictly valid JSON:
{ "items": [{ "id": "R1", "status": "met|not_met|unclear", "evidence": "...", "fix": "..." }] }

REQUIREMENTS:
${requirementLines(reqs)}

THE WORK:
${String(workText || '').slice(0, MAX_WORK_CHARS)}`;
}

/**
 * Every requirement gets a verdict; one the AI skipped is "unclear". Evidence
 * is shown as words from their work, so it's dropped unless it's really there.
 */
function normalizeWork(raw, assignment, workText) {
  const reqs = requirementsFor(assignment, { forWork: true });
  const workWords = ` ${words(workText)} `;
  const byId = new Map((Array.isArray(raw && raw.items) ? raw.items : []).filter(i => i && i.id).map(i => [String(i.id).trim(), i]));
  const items = reqs.map(r => {
    const got = byId.get(r.id) || {};
    const status = ['met', 'not_met', 'unclear'].includes(got.status) ? got.status : 'unclear';
    const evidence = str(got.evidence, 400);
    const verified = evidence && words(evidence).split(' ').length >= 2 && workWords.includes(` ${words(evidence)} `) ? evidence : '';
    return {
      id: r.id,
      kind: r.kind,
      text: r.text,
      status,
      evidence: verified,
      fix: status === 'met' ? '' : (str(got.fix, 400) || 'Ombeni couldn\'t confirm this from what you gave it.')
    };
  });
  return { items, ready: items.every(i => i.status === 'met'), truncated: String(workText || '').length > MAX_WORK_CHARS };
}

module.exports = { requirementsFor, explainPrompt, normalizeExplain, workPrompt, normalizeWork, MAX_WORK_CHARS };
