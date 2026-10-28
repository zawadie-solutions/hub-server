// Automatic local research: when a store is added, the AI gathers everything the agent needs to know about its
// community - the area, demographics, schools, local events and culture - and stores it as ordinary knowledge chunks
// (same embeddings / retrieval as hand-entered ones).
//
// Hostinger shared hosting has no always-on workers and stops processes on restart, so the web app never does this
// work itself. Adding a store (or clicking Research now) only marks it 'pending'. A cron job runs
// scripts/runResearch.js every few minutes, which claims pending stores one at a time and writes the results.
// stores.research_status: none -> pending -> running -> done | failed. The admin UI polls it.
import pool from '../config/db.js';
import { openai, CHAT_MODEL } from '../config/openai.js';
import { generateEmbeddings } from './ragService.js';
import { withTimeout } from '../utils/timeout.js';

export const AUTO_SOURCE = 'auto-research';                 // metadata.source on every chunk written here
const RESEARCH_MODEL = process.env.OPENAI_RESEARCH_MODEL || CHAT_MODEL;
const RESEARCH_TIMEOUT_MS = 170_000;                        // background work, so it may exceed the 100s request cap
const MAX_CHUNK_CHARS = 1500;                               // knowledge entries are capped at 2000 elsewhere

/* ---------- prompt ---------- */

const SHAPE = `{
  "community": "ONE paragraph: what this area is like - the town/neighborhood, the surrounding region, the local economy, how people live, shop and spend free time",
  "demographics": ["1-3 short paragraphs: population and growth, age mix and median age, households and families with children, income, education, notable groups of shoppers"],
  "schools": ["up to 6 entries, one per school district or major school/college: name, type, size if known, and the academic calendar (spring break, winter break, first and last day) when known"],
  "events": ["up to 8 entries, one per recurring or upcoming local event: name, where, typical timing, who attends, and why it matters to a LEGO / toy / collectibles store"],
  "culture": "ONE paragraph: local culture and interests - traditions, hobbies, sports teams and loyalties, arts, faith and family life, community spirit, anything that shapes what families and fans here care about"
}`;

function systemPrompt(web) {
  return `You are a local-market researcher for Bricks & Minifigs (BAM), a LEGO and collectibles retailer. The BAM marketing agent will use your notes, and nothing else, to plan campaigns for one specific store, so they must be accurate, specific to this exact place and useful for marketing to families, kids, teens and adult fans.

Cover five things: the local community, demographics, schools, local events and culture.

${web
  ? 'Use web search. Prefer official sources (school district sites, city and county sites, census.gov, chamber of commerce, event organisers). Give an exact date only when you found it on a reliable page; otherwise give the typical timing (for example "usually the first weekend of October").'
  : 'You cannot browse the web. Use only well-established facts you are confident about, and describe event and calendar timing in general terms ("usually early October"). Do not give specific calendar dates for the current or next year.'}

Rules:
- Every entry must stand alone, so name the town or district in it. Plain text only: no markdown, bullets, asterisks or links.
- Never invent a name, number, date or event. If you are unsure of something, leave it out or say it is approximate. Fewer true entries beat more doubtful ones.
- Write school breaks like "Spring Break: April 6 - 10, 2026" only when you know them.
- Keep each entry under ${MAX_CHUNK_CHARS - 500} characters.

Return ONLY a JSON object, with no text before or after it, in exactly this shape:
${SHAPE}`;
}

function userPrompt(store) {
  const where = [store.address, `${store.city}, ${store.state} ${store.zip || ''}`.trim()].filter(Boolean).join(', ');
  return `Store: ${store.name}\nAddress: ${where}\nToday: ${new Date().toISOString().slice(0, 10)}\n\nResearch the community around this store, covering its city and the nearby area its customers come from.`;
}

/* ---------- model calls ---------- */

function textAndSources(response) {
  const text = response.output_text
    ?? (response.output || []).flatMap((o) => o.content || []).filter((c) => c.type === 'output_text').map((c) => c.text).join('');
  const urls = [];
  for (const item of response.output || []) {
    for (const c of item.content || []) {
      for (const a of c.annotations || []) if (a.type === 'url_citation' && a.url && !urls.includes(a.url)) urls.push(a.url);
    }
  }
  return { text, sources: urls.slice(0, 8) };
}

/** Researches with live web search when the account allows it, otherwise falls back to the model's own knowledge. */
async function callModel(store) {
  try {
    const response = await openai.responses.create({
      model: RESEARCH_MODEL,
      tools: [{ type: 'web_search_preview', search_context_size: 'medium', user_location: { type: 'approximate', country: 'US', city: store.city, region: store.state } }],
      input: [{ role: 'system', content: systemPrompt(true) }, { role: 'user', content: userPrompt(store) }]
    }, { timeout: RESEARCH_TIMEOUT_MS });
    const out = textAndSources(response);
    if (out.text?.trim()) return { ...out, web: true };
  } catch (err) {
    console.warn(`[research] web search unavailable (${err.status || ''} ${err.message}); using model knowledge only`);
  }
  const completion = await openai.chat.completions.create({
    model: CHAT_MODEL, temperature: 0.2, response_format: { type: 'json_object' },
    messages: [{ role: 'system', content: systemPrompt(false) }, { role: 'user', content: userPrompt(store) }]
  }, { timeout: RESEARCH_TIMEOUT_MS });
  return { text: completion.choices[0].message.content, sources: [], web: false };
}

/* ---------- parsing ---------- */

const clean = (v) => {
  if (v && typeof v === 'object') v = Object.values(v).filter((x) => typeof x === 'string').join(' - ');
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').replace(/[*_`#]+/g, '').trim().slice(0, MAX_CHUNK_CHARS) : '';
};
const many = (v, max) => (Array.isArray(v) ? v : v ? [v] : []).map(clean).filter((s) => s.length >= 20).slice(0, max);

/** Pulls the JSON object out of the model's reply and turns it into [{ chunkType, content }]. */
export function parseResearch(text) {
  const start = String(text ?? '').indexOf('{'), end = String(text ?? '').lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('The research did not come back in the expected format.');
  let obj;
  try { obj = JSON.parse(text.slice(start, end + 1)); } catch { throw new Error('The research did not come back in the expected format.'); }
  const chunks = [
    ...many(obj.community, 1).map((content) => ({ chunkType: 'community', content })),
    ...many(obj.demographics, 3).map((content) => ({ chunkType: 'demographic', content })),
    ...many(obj.schools, 6).map((content) => ({ chunkType: 'school', content })),
    ...many(obj.events, 8).map((content) => ({ chunkType: 'event', content })),
    ...many(obj.culture, 1).map((content) => ({ chunkType: 'culture', content }))
  ];
  if (chunks.length < 3) throw new Error('The research came back nearly empty. Try again in a moment.');
  return chunks;
}

/* ---------- storage ---------- */

async function setStatus(locationId, status, error = null) {
  const done = status === 'done';
  await pool.execute(
    `UPDATE stores SET research_status = ?, research_error = ?${done ? ', researched_at = NOW()' : ''} WHERE location_id = ?`,
    [status, error ? String(error).slice(0, 250) : null, locationId]
  );
}

async function runResearch(store) {
  const { text, sources, web } = await withTimeout(callModel(store), RESEARCH_TIMEOUT_MS + 10_000, 'Local research');
  const chunks = parseResearch(text);
  const vectors = await withTimeout(generateEmbeddings(chunks.map((c) => c.content)), 60_000, 'Embedding');
  const metadata = JSON.stringify({ source: AUTO_SOURCE, web, model: RESEARCH_MODEL, sources, researched_at: new Date().toISOString() });

  // Swap in the new research only once it is complete: earlier auto-researched entries go, hand-entered ones stay.
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
      "DELETE FROM knowledge_chunks WHERE location_id = ? AND JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.source')) = ?",
      [store.location_id, AUTO_SOURCE]
    );
    for (let i = 0; i < chunks.length; i++) {
      await conn.execute(
        'INSERT INTO knowledge_chunks (location_id, chunk_type, content, metadata, embedding, is_active) VALUES (?, ?, ?, ?, ?, 1)',
        [store.location_id, chunks[i].chunkType, chunks[i].content, metadata, JSON.stringify(vectors[i])]
      );
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally { conn.release(); }
  return chunks.length;
}

/* ---------- queue (the web app) ---------- */

const LOCK = 'bam_research_worker';                         // held by the one worker that is running right now

/** True while a worker run is in progress (anywhere: cron, or this machine in development). */
export async function workerActive() {
  const [[row]] = await pool.query('SELECT IS_FREE_LOCK(?) AS free', [LOCK]);
  return Number(row.free) !== 1;
}

/**
 * Marks a store as waiting for the worker. Returns false if it is already waiting or being researched.
 * A store stuck on "running" because its worker died counts as free to queue again.
 */
export async function queueResearch(locationId) {
  const [res] = await pool.execute(
    `UPDATE stores SET research_status = 'pending', research_error = NULL, research_queued_at = NOW()
      WHERE location_id = ?
        AND (research_status NOT IN ('pending', 'running') OR (research_status = 'running' AND IS_FREE_LOCK(?) = 1))`,
    [locationId, LOCK]
  );
  return res.affectedRows > 0;
}

/**
 * A new playbook usually means a new quarter, so school calendars and events may have moved on. Queues every store
 * whose research is older than the active playbook. Stores never researched, or whose last attempt failed, are left
 * alone so nothing retries in a loop. Set AUTO_RESEARCH_REFRESH=off to disable. Returns how many were queued.
 */
export async function queueStaleResearch(max = 10) {
  if (/^(off|false|0|no)$/i.test(process.env.AUTO_RESEARCH_REFRESH || '') || !process.env.OPENAI_API_KEY) return 0;
  const [res] = await pool.execute(
    `UPDATE stores SET research_status = 'pending', research_error = NULL, research_queued_at = NOW()
      WHERE research_status = 'done' AND researched_at IS NOT NULL
        AND researched_at < (SELECT uploaded_at FROM playbooks WHERE is_active = 1 ORDER BY uploaded_at DESC LIMIT 1)
      ORDER BY researched_at LIMIT ${Number(max) | 0}`
  );
  return res.affectedRows;
}

/** The status the UI should show: "running" with no worker alive (the server stopped mid-run) counts as failed. */
export function effectiveStatus(row, active) {
  const status = row.research_status || 'none';
  return status === 'running' && !active ? 'failed' : status;
}

/* ---------- worker (cron job: scripts/runResearch.js) ---------- */

const MAX_RUN_MS = 25 * 60 * 1000;                          // hPanel cron jobs are capped at 30 minutes

/**
 * Researches queued stores one after another until the queue is empty or the time budget is nearly used up.
 * Only one worker runs at a time (a database lock), so overlapping cron runs simply exit.
 * Returns { skipped } when another worker holds the lock, otherwise { done, failed, queuedStale }.
 */
export async function processQueue({ maxMs = MAX_RUN_MS } = {}) {
  const started = Date.now();
  const conn = await pool.getConnection();
  const result = { skipped: false, done: 0, failed: 0, queuedStale: 0 };
  try {
    const [[lock]] = await conn.query('SELECT GET_LOCK(?, 0) AS got', [LOCK]);
    if (Number(lock.got) !== 1) return { ...result, skipped: true };

    // Holding the lock means no other worker is alive, so anything still "running" was cut off by a restart or timeout.
    await pool.execute(
      "UPDATE stores SET research_status = 'failed', research_error = 'It was interrupted before it finished (the server stopped). Try again.' WHERE research_status = 'running'"
    );
    result.queuedStale = await queueStaleResearch();

    while (Date.now() - started + RESEARCH_TIMEOUT_MS + 15_000 < maxMs) {
      const [[next]] = await pool.query("SELECT * FROM stores WHERE research_status = 'pending' ORDER BY research_queued_at, id LIMIT 1");
      if (!next) break;
      const [claim] = await pool.execute("UPDATE stores SET research_status = 'running' WHERE location_id = ? AND research_status = 'pending'", [next.location_id]);
      if (!claim.affectedRows) continue;                    // edited or re-queued by someone else in the meantime
      try {
        const n = await runResearch(next);
        await setStatus(next.location_id, 'done');
        result.done++;
        console.log(`[research] ${next.location_id}: stored ${n} entries`);
      } catch (err) {
        result.failed++;
        console.error(`[research] ${next.location_id} failed:`, err.message);
        await setStatus(next.location_id, 'failed', err.message).catch(() => {});
      }
    }
    return result;
  } finally {
    await conn.query('SELECT RELEASE_LOCK(?)', [LOCK]).catch(() => {});
    conn.release();
  }
}

/**
 * Local development only (NODE_ENV is not "production", or RESEARCH_IN_PROCESS=on): there is no cron job on a developer's
 * machine, so run the worker right away, in the background. In production the cron job does this and this does nothing.
 */
export function kickWorkerIfLocal() {
  const local = process.env.NODE_ENV !== 'production' || /^(on|true|1|yes)$/i.test(process.env.RESEARCH_IN_PROCESS || '');
  if (local) processQueue().catch((err) => console.error('[research] worker failed:', err.message));
}
