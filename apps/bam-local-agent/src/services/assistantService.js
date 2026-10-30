import {
  generateEmbedding, findRelevantContext, getStoreProfile, generateCompletion, completeWithBrandCheck, activePlaybook,
  resultMeta, previousSection, section, storeText, longDate, str, pastDates, BRAND_RULES, isEventPlanRequest,
  generateEventPlan, generateMarketingPlan
} from './ragService.js';
import { eventPlanText } from '../utils/slackFormatter.js';

/* ---------- Routing: what does the user actually want? ---------- */

export const INTENTS = ['event_plan', 'marketing_plan', 'content', 'answer'];
const KINDS = ['email', 'social_post', 'sms', 'flyer', 'newsletter', 'press_release', 'letter', 'script', 'other'];

const ROUTER_SYSTEM = `You route requests for the BAM Local Agent, the marketing assistant for one Bricks & Minifigs (LEGO buy, sell and trade) store. Decide what the user wants.

intent:
- "event_plan": a full plan or playbook for ONE specific event: they ask for an event plan, event playbook or event brief, or to plan, host, organize or run an event, workshop, contest, party, make & take, build night, open house or fundraiser.
- "marketing_plan": strategy, ideas or a campaign/promotion plan that is not one specific event ("What should we run for Spring Break?", "Plan our Mother's Day promotion", "How can we hit the NIB goal?").
- "content": ready-to-use writing: an email, social media post or caption, text message, flyer or poster copy, newsletter, press release, letter, script, sign, ad copy, or a reply to a customer. Also a rewrite of earlier writing ("make it shorter", "more formal").
- "answer": a question or lookup ("When is Cobb County spring break?", "Which schools are near the store?", "What is the Built for Any Occasion goal?", "Summarize the playbook"), and anything else.
Writing ABOUT an event or plan ("write an Instagram post for this event", "a reminder text for the build night", "email the school about the event") is "content", not "event_plan". Use "event_plan" only when they want the plan itself.

deliverables: every piece of writing the user asked for, one entry per separate piece, in order, max 6.
- "kind": one of ${KINDS.join(', ')}.
- "brief": who it is for and what it must do, in the user's words (e.g. "partnership email to King Springs Elementary about the spring break event").
- A plan request can also ask for writing ("...include a partner email draft for King Springs Elementary"): keep the plan intent and list the writing here.
- Several recipients get separate pieces only when the user names each one or says "each"/"separate"; otherwise one piece.
- Empty array when no writing was asked for. Never empty for "content".

uses_previous: true only when a PREVIOUS REQUEST is shown and this request refers to or continues it ("this event", "the plan", "idea 2", "make it shorter", "now the email", "same for Instagram"). Otherwise false.

Return ONLY JSON: { "intent": "", "deliverables": [ { "kind": "", "brief": "" } ], "uses_previous": false }`;

const WRITING_RE = /\b(e-?mails?|posts?|captions?|tweets?|flyers?|posters?|letters?|newsletters?|text messages?|sms|press release|announcement|script|ad copy|reply|respond|write|draft|compose)\b/i;
const QUESTION_RE = /^(what|when|where|who|whom|which|why|how (many|much|long|far)|is|are|was|were|does|do|did|can|could|tell me|list|summari[sz]e|explain)\b/i;

/** Keyword fallback for when the router call fails, so a request is never lost. */
export function guessIntent(query) {
  const q = String(query ?? '').trim();
  const writing = WRITING_RE.test(q);
  if (isEventPlanRequest(q)) return { intent: 'event_plan', deliverables: [] };
  if (writing && !/\bshould we\b/i.test(q)) return { intent: 'content', deliverables: [{ kind: 'other', brief: q }] };
  if (QUESTION_RE.test(q) && !/\b(should we|plan|ideas?|strategy|promot)/i.test(q)) return { intent: 'answer', deliverables: [] };
  return { intent: 'marketing_plan', deliverables: [] };
}

export function normalizeRoute(raw, query) {
  let o;
  try { o = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return null; }
  if (!o || !INTENTS.includes(o.intent)) return null;
  const deliverables = (Array.isArray(o.deliverables) ? o.deliverables : []).slice(0, 6)
    .map((d) => ({ kind: KINDS.includes(d?.kind) ? d.kind : 'other', brief: str(d?.brief, 300) })).filter((d) => d.brief);
  if (o.intent === 'content' && !deliverables.length) deliverables.push({ kind: 'other', brief: str(query, 300) });
  return { intent: o.intent, deliverables: o.intent === 'answer' ? [] : deliverables, uses_previous: o.uses_previous === true };
}

/** One small, deterministic call that decides which generator answers the request. */
export async function routeRequest(query, previous = null) {
  const user = `${previous ? `PREVIOUS REQUEST: ${previous.question}\n\n` : ''}REQUEST: ${query}`;
  try {
    const route = normalizeRoute(await generateCompletion([{ role: 'system', content: ROUTER_SYSTEM }, { role: 'user', content: user }], { json: true, temperature: 0 }), query);
    if (route) return { ...route, uses_previous: route.uses_previous && !!previous };
  } catch (err) {
    console.error('[bam-local-agent] request routing failed, using keyword fallback:', err.message);
  }
  return { ...guessIntent(query), uses_previous: false };
}

/* ---------- Shared context ---------- */

async function loadContext(query, locationId, previous, opts) {
  const store = await getStoreProfile(locationId);
  if (!store) throw new Error(`Unknown location_id: ${locationId}`);
  const vector = await generateEmbedding(previous ? `${query}\n${previous.text.slice(0, 600)}` : query);
  const [context, playbook] = await Promise.all([findRelevantContext(vector, locationId, 14, opts), activePlaybook()]);
  const by = (kind) => context.filter((c) => c.kind === kind);
  const contextText = `STORE:
${storeText(store)}

${section('A) LOCAL DATA', by('local'))}

${section('B) PLAYBOOK KEY FACTS', by('facts'))}

${section('C) PLAYBOOK EXCERPTS', by('excerpt'))}`;
  return { store, playbook, context, contextText };
}

const SOURCES = `You are given context:
A) LOCAL DATA for this store - authoritative for its address, audience, schools, community and local events.
B) PLAYBOOK KEY FACTS - verified, authoritative for campaign names, goals, targets, promos, dates and rules.
C) PLAYBOOK EXCERPTS - raw PDF text, can be fragmented. Use it only for detail. If it conflicts with B, B wins. Never take a number from C.`;

const address = (s) => [s.address, `${s.city}, ${s.state} ${s.zip ?? ''}`.trim()].filter(Boolean).join(', ');
const list = (v, n, max = 220) => (Array.isArray(v) ? v : []).map((x) => str(x, max)).filter(Boolean).slice(0, n);

/* ---------- Content: emails, social posts, flyers, texts... ---------- */

const FORMATS = (store) => `FORMATS
- email: "to" = the recipient (organization or role). "subject" = specific, under 70 characters. "body" = greeting ("Dear [Principal's name]," for a school or business, "Hi [First name]," for a customer), then 2-4 short paragraphs: who we are in one line, why we are writing, the concrete details (what, when, where, cost, what we provide, what we ask of them), one clear call to action with a proposed next step. End with:
Best regards,
[Your name]
[Your title], ${store.name}
${address(store)}
[Store phone] | [Store email]
Keep it 120-220 words unless the user asks otherwise.
- social_post: "platform" = the platform asked for (default "Instagram & Facebook"). Hook in the first line, then what, when and where, then a call to action. 40-110 words (X: under 260 characters). Up to 3 fitting emojis. 3-6 hashtags in "hashtags", not in the body, including #BricksAndMinifigs and one local tag; no years in hashtags.
- sms: one message under 160 characters that names the store.
- flyer: "headline" = the big title. "body" = a subheadline, 3-4 short lines on what people get, the details (date, time, place, price) and a call to action, each on its own line.
- newsletter: "subject", then a short intro, 2-3 short sections each starting with a plain heading line, and a call to action.
- press_release: "headline", then FOR IMMEDIATE RELEASE, a dateline (${store.city}, ${store.state} - [Date]), 3-4 paragraphs with one quote from [Store owner name], an "About Bricks & Minifigs" paragraph and "Media contact: [Name] | [Phone] | [Email]".
- letter, script, other: the layout a professional would use for that piece.`;

/** Ready-to-use writing for one store. `eventPlan` (plain text) ties the writing to an event plan generated in the same request. */
export async function generateContent(userQuery, locationId, { deliverables = [], previous = null, eventPlan = null, today = new Date() } = {}) {
  const { store, playbook, context, contextText } = await loadContext(userQuery, locationId, previous, { minLocal: 6, minFacts: 5 });
  const pieces = deliverables.length ? deliverables : [{ kind: 'other', brief: userQuery }];

  const system = `You are the BAM Local Agent for Bricks & Minifigs, a LEGO buy, sell and trade store. You are an experienced marketing copywriter writing for ONE store: ${store.name}. Write exactly what is asked, finished and ready to send or post.

Today is ${longDate(today)}. Active marketing playbook: ${playbook ? playbook.label : 'none'}.

${SOURCES}

HOW TO WRITE
1. Professional, warm, clear and clean. Short paragraphs and plain words. Get to the point in the first sentence. Never use filler openers such as "I hope this message finds you well", "I hope you are doing well" or "I am writing to"; no hype words ("exciting", "amazing", "fantastic"), no ALL CAPS, no exclamation mark in an email subject and at most one in a piece.
2. Be specific: use the store's name and address and the named schools, venues, dates, times and promos from the context. Every fact must come from the context.
3. Make vague requests concrete. If the user doesn't say what the message is about, build it around the most relevant upcoming opportunity in the context (the next school break, campaign or event) and make a specific proposal: a named activity, when (a date or bracketed estimate), where, the cost (e.g. free for students) and what we provide, plus one specific ask. A message that only "explores partnership opportunities" or asks "to discuss possibilities" without a concrete proposal is not acceptable.
4. Writing to a group ("local schools", "our partners") without naming one: write one message that works for each of them, with a [School name] style placeholder, and add a note naming the recipients from A it should go to.
5. Never invent people's names, phone numbers, email addresses, links, prices, dates or agreements. When a needed detail is missing, use a short placeholder in square brackets, e.g. [Principal's name], [Sign-up link]. Don't use a placeholder for something the context gives.
6. Dates before today (${longDate(today)}) have passed: never present one as upcoming.${eventPlan ? `
7. Event details come from D, the event plan, and must match it exactly: same title, dates, times, place and activities. If D's date is an estimate or marked [Confirm with Store], write the date itself in square brackets so it is flagged, e.g. "the week of [April 6-10, 2027]".` : `
7. If the only date you have for something has passed, use its next occurrence only as a bracketed estimate, e.g. [Week of April 5-9, 2027], or [Event date].`}
8. The store is the sender unless the user says otherwise. Write in the store's voice ("we").
9. A request to change earlier writing (shorter, more formal, add a detail) means rewriting that piece from D.
10. notes are instructions for the person sending, in plain sentences ("Add the principal's name.", "Send to King Springs and Argyle Elementary."), not a list of bare placeholders.

${FORMATS(store)}

${BRAND_RULES}

Write these pieces, one per entry, in this order:
${pieces.map((d, i) => `${i + 1}. ${d.kind}: ${d.brief}`).join('\n')}

OUTPUT: return ONLY a JSON object:
{
  "intro": "one short sentence saying what you wrote, no pep talk",
  "pieces": [ { "kind": "${KINDS.join('|')}", "label": "short card title, e.g. 'Partnership email - King Springs Elementary'", "to": "", "subject": "", "platform": "", "headline": "", "body": "the full text; blank line between paragraphs; no markdown or asterisks", "hashtags": [] } ],
  "notes": ["each placeholder or fact to confirm before sending, max 5"],
  "follow_ups": ["up to 3 short next requests this user is likely to want, phrased the way they would type them"]
}
Leave fields that don't apply to a kind as empty strings or arrays.

${contextText}${eventPlan ? `\n\nD) THE EVENT PLAN this writing is for - use its title, dates, times, place, activities and cost exactly as written:\n${eventPlan}` : previousSection(previous)}`;

  const messages = [{ role: 'system', content: system }, { role: 'user', content: userQuery }];
  let text = await completeWithBrandCheck(messages);
  let content = normalizeContent(text);

  // Quality check: one rewrite pass if a past date is presented as upcoming or a filler opener slipped in.
  const problems = writingProblems(content.pieces, today);
  if (problems.length) {
    text = await completeWithBrandCheck([
      ...messages,
      { role: 'assistant', content: text },
      { role: 'user', content: `Fix these problems and return the full JSON again, keeping everything else the same:\n- ${problems.join('\n- ')}` }
    ]);
    const fixed = normalizeContent(text);
    if (fixed.pieces.length) content = fixed;
  }
  return { type: 'content', content, ...resultMeta(context, store, playbook) };
}

const FILLER = /\b(i hope (this|my|the) (message|email|e-mail|note|letter) finds you( well)?|i hope (you are|you're|this finds you) (doing )?well|i am writing to)\b/i;

/** What a rewrite pass should fix: dates that have already passed (outside [brackets]) and filler openers. */
export function writingProblems(pieces, today = new Date()) {
  const problems = [];
  for (const p of pieces) {
    const unbracketed = `${p.subject}\n${p.headline}\n${p.body}`.replace(/\[[^\]]*\]/g, '');
    const past = pastDates(unbracketed, today);
    if (past.length) problems.push(`"${pieceTitle(p)}" gives ${past.map((d) => `"${d}"`).join(', ')}, which is before today (${longDate(today)}): use the upcoming date from the context, or a bracketed estimate of the next occurrence.`);
    const filler = p.body.match(FILLER);
    if (filler) problems.push(`"${pieceTitle(p)}" uses the filler phrase "${filler[0]}": open with the purpose instead.`);
  }
  return problems;
}

export function normalizeContent(raw) {
  let o;
  try { o = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return { intro: '', pieces: [], notes: [], follow_ups: [], raw: String(raw ?? '').trim() }; }
  const pieces = (Array.isArray(o?.pieces) ? o.pieces : []).slice(0, 6).map((p) => ({
    kind: KINDS.includes(p?.kind) ? p.kind : 'other',
    label: str(p?.label, 120),
    to: str(p?.to, 160),
    subject: str(p?.subject, 160),
    platform: str(p?.platform, 60),
    headline: str(p?.headline, 160),
    body: str(p?.body, 4000).replace(/\*\*(.+?)\*\*/g, '$1').replace(/\n{3,}/g, '\n\n'),
    hashtags: list(p?.hashtags, 8, 40).map((t) => (t.startsWith('#') ? t : `#${t}`).replace(/\s+/g, ''))
  })).filter((p) => p.body);
  const content = { intro: str(o?.intro, 300), pieces, notes: list(o?.notes, 5), follow_ups: list(o?.follow_ups, 3, 140) };
  return pieces.length ? content : { ...content, raw: String(raw ?? '').trim() };
}

const KIND_LABEL = { email: 'Email', social_post: 'Social post', sms: 'Text message', flyer: 'Flyer', newsletter: 'Newsletter', press_release: 'Press release', letter: 'Letter', script: 'Script', other: 'Draft' };
export const pieceTitle = (p) => p.label || KIND_LABEL[p.kind] || 'Draft';

/** Plain text of one piece, as it would be pasted into an email client or social app. */
export function pieceText(p) {
  const head = [p.to && `To: ${p.to}`, p.subject && `Subject: ${p.subject}`, p.platform && `Platform: ${p.platform}`].filter(Boolean).join('\n');
  return [head, p.headline, p.body, p.hashtags.join(' ')].filter(Boolean).join('\n\n');
}

export const piecesText = (pieces) => pieces.map((p) => `${pieceTitle(p).toUpperCase()}\n\n${pieceText(p)}`).join('\n\n---\n\n');

/* ---------- Answers: questions and lookups ---------- */

export async function generateAnswer(userQuery, locationId, { previous = null, today = new Date() } = {}) {
  const { store, playbook, context, contextText } = await loadContext(userQuery, locationId, previous, { minLocal: 5, minFacts: 6 });

  const system = `You are the BAM Local Agent for Bricks & Minifigs, the marketing team's assistant for ONE store: ${store.name}. Answer the user's question accurately, clearly and briefly.

Today is ${longDate(today)}. Active marketing playbook: ${playbook ? playbook.label : 'none'}.

${SOURCES}

RULES
1. Lead with the direct answer in 1-3 sentences. Then give only the supporting details that help (names, dates, numbers, what it means for the store) as short points.
2. Store, local and playbook facts come only from the context. Say where a fact comes from when it matters (the store's local data, or the playbook campaign by name).
3. If the context does not contain the answer, say so plainly, share the closest related facts you have, and say how to confirm it. Never guess dates, numbers, names or links.
4. Dates before today have passed: describe them in the past tense, and give a future date only as an estimate that needs confirming.
5. General questions that are not about the store or playbook (wording help, marketing know-how): answer from general knowledge, practically and briefly.
6. Plain text only: no markdown, asterisks or bullet characters inside values.

${BRAND_RULES}

OUTPUT: return ONLY a JSON object:
{
  "answer": "the direct answer, 1-3 sentences",
  "points": [ { "label": "optional 1-4 word label", "text": "supporting detail" } ],
  "caveat": "what to confirm, or an empty string",
  "follow_ups": ["up to 3 short next requests this user is likely to want, phrased the way they would type them"]
}
Use 0-6 points.

${contextText}${previousSection(previous)}`;

  const text = await completeWithBrandCheck([{ role: 'system', content: system }, { role: 'user', content: userQuery }]);
  return { type: 'answer', reply: normalizeReply(text), ...resultMeta(context, store, playbook) };
}

export function normalizeReply(raw) {
  let o;
  try { o = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return { answer: String(raw ?? '').trim(), points: [], caveat: '', follow_ups: [] }; }
  return {
    answer: str(o?.answer, 900) || 'I could not find an answer to that in the playbook or this store\'s local data.',
    points: (Array.isArray(o?.points) ? o.points : []).slice(0, 6).map((p) => ({ label: str(p?.label, 60), text: str(p?.text, 400) })).filter((p) => p.text),
    caveat: str(o?.caveat, 300),
    follow_ups: list(o?.follow_ups, 3, 140)
  };
}

export const replyText = (r) => [r.answer, ...r.points.map((p) => `- ${p.label ? `${p.label}: ` : ''}${p.text}`), r.caveat && `\nTo confirm: ${r.caveat}`].filter(Boolean).join('\n');

/* ---------- Entry point ---------- */

/**
 * Answers one request for one store. The router picks the generator:
 * - event_plan: the Event Planning Framework card (5 W's + How Much), plus any writing asked for alongside it
 *   ("...include a partner email draft") written from the finished plan, so names, dates and times match.
 * - marketing_plan: the structured marketing plan.
 * - content: emails, social posts, flyers, texts, letters... ready to send.
 * - answer: a direct answer to a question.
 * `mode` forces one of these (admin sandbox / API); `previous` is the last result on the page, used only when the
 * request builds on it.
 */
export async function generateLocalizedResult(userQuery, locationId, { mode = 'auto', previous = null, today = new Date() } = {}) {
  const route = INTENTS.includes(mode)
    ? { intent: mode, deliverables: mode === 'content' ? [{ kind: 'other', brief: userQuery }] : [], uses_previous: !!previous }
    : await routeRequest(userQuery, previous);
  const prev = route.uses_previous ? previous : null;
  let result;

  if (route.intent === 'event_plan') {
    result = await generateEventPlan(userQuery, locationId, { previous: prev, today });
    if (result.plan && route.deliverables.length) {
      const planText = eventPlanText(result.plan, { store: result.store, playbook: result.playbook });
      const writing = await generateContent(userQuery, locationId, { deliverables: route.deliverables, eventPlan: planText, today });
      result.pieces = writing.content.pieces;
      result.notes = writing.content.notes;
    }
    result.follow_ups = [
      !route.deliverables.some((d) => d.kind === 'email') && 'Draft the partner outreach email for this event',
      !route.deliverables.some((d) => d.kind === 'social_post') && 'Write an Instagram and Facebook post announcing this event',
      'Write a reminder text for families who signed up'
    ].filter(Boolean).slice(0, 3);
  } else if (route.intent === 'content') {
    result = await generateContent(userQuery, locationId, { deliverables: route.deliverables, previous: prev, today });
  } else if (route.intent === 'answer') {
    result = await generateAnswer(userQuery, locationId, { previous: prev, today });
  } else {
    result = await generateMarketingPlan(userQuery, locationId, { previous: prev });
    if (route.deliverables.length && !result.answer.raw) {
      const writing = await generateContent(userQuery, locationId, { deliverables: route.deliverables, previous: prev, today });
      result.pieces = writing.content.pieces;
      result.notes = writing.content.notes;
    }
    result.follow_ups = ['Turn the first idea into a full event plan', 'Write social posts for this plan', 'Draft an email to a local school about this'];
  }
  return { ...result, route: { intent: route.intent, deliverables: route.deliverables.map((d) => d.kind), uses_previous: !!prev } };
}
