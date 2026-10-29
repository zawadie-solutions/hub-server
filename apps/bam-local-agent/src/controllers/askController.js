import pool from '../config/db.js';
import { generateLocalizedResult } from '../services/ragService.js';
import { eventPlanBlocks, eventPlanText } from '../utils/slackFormatter.js';
import { storeExists, listStores } from '../services/storeService.js';
import { effectiveStatus, workerActive } from '../services/localResearchService.js';
import { withTimeout, MAX_OPERATION_MS } from '../utils/timeout.js';
import { hit } from '../utils/rateLimit.js';

/** Stores and the active playbook label for the planner's store picker. */
export async function askMeta(req, res, next) {
  try {
    const [extra] = await pool.execute(
      `SELECT s.location_id, s.research_status,
              (SELECT COUNT(*) FROM knowledge_chunks c WHERE c.location_id = s.location_id AND c.is_active = 1) AS knowledge_count
         FROM stores s`
    );
    const active = await workerActive();
    const stores = (await listStores()).map(({ location_id, name, address, city, state, zip }) => {
      const e = extra.find((x) => x.location_id === location_id);
      return {
        location_id, name, address, city, state, zip,
        knowledge_count: Number(e?.knowledge_count ?? 0),
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

/** Optional `mode` in the request body: 'event_plan' or 'marketing_plan' forces one; anything else lets the question decide. */
export const planMode = (mode) => (['event_plan', 'marketing_plan'].includes(mode) ? mode : 'auto');

/** Event plan fields for the pages: the plan, its plain text (Copy / Download) and, when asked, the Slack Block Kit message. */
export function eventPlanOutput(result, { slack = false } = {}) {
  if (!result.plan) return { plan: null, raw: result.raw };
  const meta = { store: result.store, playbook: result.playbook };
  return { plan: result.plan, text: eventPlanText(result.plan, meta), ...(slack ? { slack: eventPlanBlocks(result.plan, meta) } : {}) };
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
    const result = await withTimeout(generateLocalizedResult(question.trim(), location_id, { mode: planMode(req.body.mode) }), MAX_OPERATION_MS, 'Response generation');
    const base = { type: result.type, store: result.store, playbook: result.playbook, consulted: consulted(result) };
    res.json(result.type === 'event_plan' ? { ...base, ...eventPlanOutput(result) } : { ...base, answer: result.answer });
  } catch (err) { next(err); }
}
