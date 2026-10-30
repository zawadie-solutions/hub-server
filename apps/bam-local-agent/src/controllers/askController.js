import pool from '../config/db.js';
import { generateLocalizedResult, INTENTS, piecesText, replyText } from '../services/assistantService.js';
import { USABLE_CHUNK_SQL } from '../services/ragService.js';
import { eventPlanBlocks, eventPlanText } from '../utils/slackFormatter.js';
import { storeExists, listStores } from '../services/storeService.js';
import { effectiveStatus, workerActive } from '../services/localResearchService.js';
import { withTimeout, MAX_OPERATION_MS } from '../utils/timeout.js';
import { hit } from '../utils/rateLimit.js';

/** Stores and the active playbook label for the planner's store picker. */
export async function askMeta(req, res, next) {
  try {
    // knowledge_count: local facts the AI actually uses; awaiting_review: AI-researched facts not used until reviewed.
    const [extra] = await pool.execute(
      `SELECT s.location_id, s.research_status,
              (SELECT COUNT(*) FROM knowledge_chunks c WHERE c.location_id = s.location_id AND c.is_active = 1 AND ${USABLE_CHUNK_SQL}) AS knowledge_count,
              (SELECT COUNT(*) FROM knowledge_chunks c WHERE c.location_id = s.location_id AND c.is_active = 1 AND NOT ${USABLE_CHUNK_SQL}) AS awaiting_review
         FROM stores s`
    );
    const active = await workerActive();
    const stores = (await listStores()).map(({ location_id, name, address, city, state, zip }) => {
      const e = extra.find((x) => x.location_id === location_id);
      return {
        location_id, name, address, city, state, zip,
        knowledge_count: Number(e?.knowledge_count ?? 0),
        awaiting_review: Number(e?.awaiting_review ?? 0),
        research_status: e ? effectiveStatus(e, active) : 'none'
      };
    });
    const [pb] = await pool.execute('SELECT quarter, year FROM playbooks WHERE is_active = 1 LIMIT 1');
    res.json({ stores, playbook: pb[0] ? { label: `Q${pb[0].quarter} ${pb[0].year}` } : null });
  } catch (err) { next(err); }
}

// Plain-language list of what the answer drew on (no raw chunk text is sent to marketing users).
function consulted(result) {
  const names = new Set();
  for (const s of result.sources) {
    if (s.kind === 'facts' && s.heading && names.size < 6) names.add(s.heading.replace(/\s*\(.*$/, '').trim());
    if (s.kind === 'local') names.add(`${result.store.city} ${s.chunkType} data`);
  }
  return [...names];
}

/** Optional `mode` in the request body: 'event_plan', 'marketing_plan', 'content' or 'answer' forces one; anything else lets the request decide. */
export const planMode = (mode) => (INTENTS.includes(mode) ? mode : 'auto');

/**
 * The page's last result, sent back so a follow-up ("now write the email for this event") can build on it.
 * Plain text only and capped; it is used as reference data in the prompt, never as instructions.
 */
export function previousInput(v) {
  if (!v || typeof v !== 'object' || typeof v.question !== 'string' || typeof v.text !== 'string') return null;
  const question = v.question.trim().slice(0, 500), text = v.text.trim().slice(0, 4000);
  return question && text ? { question, text } : null;
}

/** Event plan fields for the pages: the plan, its plain text (Copy / Download) and, when asked, the Slack Block Kit message. */
export function eventPlanOutput(result, { slack = false } = {}) {
  if (!result.plan) return { plan: null, raw: result.raw };
  const meta = { store: result.store, playbook: result.playbook };
  const pieces = result.pieces ?? [];
  const text = eventPlanText(result.plan, meta) + (pieces.length ? `\n\n\n${piecesText(pieces)}` : '');
  return { plan: result.plan, text, pieces, notes: result.notes ?? [], ...(slack ? { slack: eventPlanBlocks(result.plan, meta) } : {}) };
}

/** Everything a page needs for one result, whatever its type. `text` is the plain-text version used by Copy and as the next request's `previous`. */
export function resultOutput(result, opts) {
  const base = { type: result.type, store: result.store, playbook: result.playbook, follow_ups: result.follow_ups ?? [], route: result.route };
  if (result.type === 'event_plan') return { ...base, ...eventPlanOutput(result, opts) };
  if (result.type === 'content') {
    const c = result.content;
    return { ...base, content: c, text: c.raw ?? piecesText(c.pieces), follow_ups: c.follow_ups };
  }
  if (result.type === 'answer') return { ...base, reply: result.reply, text: replyText(result.reply), follow_ups: result.reply.follow_ups };
  return { ...base, answer: result.answer, pieces: result.pieces ?? [], notes: result.notes ?? [] };
}

export async function askQuestion(req, res, next) {
  try {
    const limit = hit(`ask:${req.ip}`, 20, 10 * 60 * 1000);   // each question costs an OpenAI call
    if (!limit.ok) {
      res.set('Retry-After', String(limit.retryAfterSec));
      return res.status(429).json({ error: `That's a lot of questions in a short time. Please wait about ${Math.ceil(limit.retryAfterSec / 60)} minute(s) and try again.` });
    }
    const { location_id, question } = req.body;
    if (!(await storeExists(location_id))) return res.status(400).json({ error: 'Choose a store first.' });
    if (typeof question !== 'string' || question.trim().length < 5 || question.length > 500) {
      return res.status(400).json({ error: 'Type a question between 5 and 500 characters.' });
    }
    const result = await withTimeout(
      generateLocalizedResult(question.trim(), location_id, { mode: planMode(req.body.mode), previous: previousInput(req.body.previous) }),
      MAX_OPERATION_MS, 'Response generation');
    res.json({ ...resultOutput(result), consulted: consulted(result) });
  } catch (err) { next(err); }
}
