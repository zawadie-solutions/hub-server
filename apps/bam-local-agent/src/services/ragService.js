import pool from '../config/db.js';
import { openai, EMBEDDING_MODEL, CHAT_MODEL, OPENAI_TIMEOUT_MS } from '../config/openai.js';

const MAX_EMBED_CHARS = 8000;
const parseJson = (v) => (v == null ? null : typeof v === 'string' ? JSON.parse(v) : v); // MySQL returns objects, MariaDB strings

/* ---------- Embeddings ---------- */

export async function generateEmbeddings(texts) {
  const input = texts.map((t) => String(t).trim().slice(0, MAX_EMBED_CHARS) || ' ');
  const res = await openai.embeddings.create({ model: EMBEDDING_MODEL, input }, { timeout: OPENAI_TIMEOUT_MS });
  return res.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

export async function generateEmbedding(text) {
  const [vector] = await generateEmbeddings([text]);
  return vector;
}

export function cosineSimilarity(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

/* ---------- Storage ---------- */

export async function insertChunk({
  locationId = null, playbookId = null, chunkType, content, embedding,
  metadata = null, quarter = null, isActive = true
}) {
  const [result] = await pool.execute(
    `INSERT INTO knowledge_chunks
       (location_id, playbook_id, chunk_type, content, metadata, embedding, quarter, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [locationId, playbookId, chunkType, content, metadata ? JSON.stringify(metadata) : null,
     JSON.stringify(embedding), quarter, isActive ? 1 : 0]
  );
  return result.insertId;
}

export async function getStoreProfile(locationId) {
  const [rows] = await pool.execute(
    'SELECT location_id, name, address, city, state, zip, profile FROM stores WHERE location_id = ?',
    [locationId]
  );
  if (!rows[0]) return null;
  return { ...rows[0], profile: parseJson(rows[0].profile) };
}

/* ---------- Retrieval ---------- */

/**
 * Returns chunks tagged kind = 'local' (this store's own data), 'facts' (verified playbook key facts)
 * or 'excerpt' (raw playbook PDF text). Slots are reserved for local data and key facts because the long
 * raw excerpts otherwise outrank them in plain similarity ranking.
 */
export async function findRelevantContext(queryVector, locationId, topK = 14, { minLocal = 4, minFacts = 6 } = {}) {
  const [rows] = await pool.execute(
    `SELECT id, location_id, chunk_type, content, metadata, embedding, quarter
       FROM knowledge_chunks
      WHERE is_active = 1 AND (location_id = ? OR location_id IS NULL)`,
    [locationId]
  );
  const scored = rows.map((r) => {
    const metadata = parseJson(r.metadata);
    return {
      id: r.id,
      kind: r.location_id !== null ? 'local' : metadata?.kind === 'key_facts' ? 'facts' : 'excerpt',
      chunkType: r.chunk_type,
      content: r.content,
      metadata,
      quarter: r.quarter,
      score: cosineSimilarity(queryVector, JSON.parse(r.embedding))
    };
  }).sort((a, b) => b.score - a.score);

  const take = (kind, n) => scored.filter((c) => c.kind === kind).slice(0, n);
  const local = take('local', minLocal);
  const facts = take('facts', minFacts);
  const excerpts = take('excerpt', Math.max(topK - local.length - facts.length, 2));
  return [...local, ...facts, ...excerpts];
}

/* ---------- Generation ---------- */

export async function generateCompletion(messages, { temperature = 0.3, model = CHAT_MODEL, json = false } = {}) {
  const completion = await openai.chat.completions.create(
    { model, temperature, messages, ...(json ? { response_format: { type: 'json_object' } } : {}) },
    { timeout: OPENAI_TIMEOUT_MS }
  );
  return completion.choices[0].message.content;
}

// Phrases the playbook forbids in public-facing copy (Star Wars IP). "LEGO Star Wars", "Star Wars fans",
// "May the 4th" and "Join the Brick Side" are allowed.
const BANNED = [
  /star wars day/i, /may the fourth be with you/i, /may the force/i, /long time ago in a galaxy/i,
  /\bthe force\b/i, /this is the way/i, /\b(dark|light) side\b/i, /\b(jedi|sith|padawan|droids?)\b/i
];
export const findBrandViolations = (text) => BANNED.filter((re) => re.test(text)).map((re) => text.match(re)[0]);

const str = (v, max = 400) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Validates the model's JSON; falls back to { raw } so a malformed reply still reaches the user. */
export function normalizeAnswer(raw) {
  let obj;
  try { obj = JSON.parse(raw); } catch { return { raw: String(raw ?? '').trim() }; }
  const answer = {
    audience: str(obj.audience),
    playbook_rules: (Array.isArray(obj.playbook_rules) ? obj.playbook_rules : []).slice(0, 4)
      .map((r) => ({ campaign: str(r?.campaign, 120), dates: str(r?.dates, 120), rule: str(r?.rule) })).filter((r) => r.rule),
    local_plays: (Array.isArray(obj.local_plays) ? obj.local_plays : []).slice(0, 6)
      .map((p) => ({ action: str(p?.action, 200), local_hook: str(p?.local_hook), playbook_support: str(p?.playbook_support) })).filter((p) => p.action),
    heads_up: str(obj.heads_up)
  };
  return answer.local_plays.length || answer.playbook_rules.length ? answer : { raw: String(raw).trim() };
}

const BRAND_RULES = `Brand & legal rules (never break these):
- Never write: "Star Wars Day", "May the Fourth be with you", "May the Force be with you", "A long time ago in a galaxy far, far away", "The Force", "This is the Way", "Dark Side", "Light Side", "Jedi", "Sith", "Padawan", "Droid", or any Star Wars character/vehicle/species/faction name. Allowed: "May the 4th", "LEGO Star Wars", "Star Wars fans", "Join the Brick Side".
- Weeks run Monday-Sunday (ISO-8601) when you number weeks. Write dates the way people read them ("Mon, Apr 6", "April 6-10"); never as 2026-04-06.`;

const section = (title, items) =>
  `${title}\n${items.length ? items.map((c, i) => `[${i + 1}] ${c.content}`).join('\n\n') : '(none)'}`;

/**
 * Full RAG answer for one store. Returns { answer, sources, counts, model, playbook, store } where `answer` is
 * structured ({ audience, playbook_rules[], local_plays[], heads_up }) so the marketing planner and the admin UI can both render it.
 */
export async function generateLocalizedResult(userQuery, locationId) {
  const store = await getStoreProfile(locationId);
  if (!store) throw new Error(`Unknown location_id: ${locationId}`);

  const context = await findRelevantContext(await generateEmbedding(userQuery), locationId);
  const by = (kind) => context.filter((c) => c.kind === kind);

  const storeText =
    `${store.name} - ${[store.address, store.city, store.state, store.zip].filter(Boolean).join(', ')}` +
    (store.profile ? `\nProfile: ${JSON.stringify(store.profile)}` : '');

  const system = `You are the BAM Local Agent for Bricks & Minifigs. You turn the quarterly BAM Marketing Playbook into practical, store-specific marketing plans for ONE store.

You are given three kinds of context:
A) LOCAL DATA for this store - authoritative for its audience, schools, events and dates.
B) PLAYBOOK KEY FACTS - verified, authoritative for campaign names, goals, targets, promos, dates and rules.
C) PLAYBOOK EXCERPTS - raw text from the PDF; it can be fragmented. Use it only to add detail. If it conflicts with B, B wins. Never take a number from C.

RULES
1. Attribute every goal, number and promo to its own campaign and date range exactly as written in B. Never move a target from one campaign to another (for example the passport target belongs to "Put Bricks & Minifigs on the Map", June 1-28, not to Spring Break).
2. Lead with the audience that A describes for this store. Use the playbook's default audience for a campaign only as a secondary point or when A agrees with it.
3. Anchor the plan in A: name the local schools, venues, events and dates that appear in A. At least half of the local_plays must use a local detail from A.
4. Only say two things overlap or happen together when the context gives dates for both. If a date is missing, say it is unconfirmed. Never invent dates, numbers, attendance or promos.
5. Be specific and actionable. Every local_plays item must say what to DO, name a concrete local detail from A, and cite a concrete promo, goal, number or date from B (leave playbook_support empty if B has none; never restate a campaign's goal or message as the reason). No generic filler ("use social media", "offer deals") and no closing pep talk.
6. Related campaigns: when B shows another campaign or sub-campaign that starts or runs inside the same dates as the local data (for example Built for Any Occasion launching Mon, Apr 6, with its per-store goal), include it in playbook_rules with its own goal and dates.
7. Local audience detail: use everything A says about who shops at this store (students, adult LEGO fans, grandparents, tourists...), not just the headline audience.
8. heads_up: only a concrete gap, such as a local event in A with no date, or detail that lives in the separate Event Playbook. No generic reminders; use an empty string if nothing is missing.

OUTPUT: return ONLY a JSON object with exactly these keys. Plain text values only (no markdown, asterisks or bullets), each under 220 characters:
{
  "audience": "one line, local audience first",
  "playbook_rules": [ { "campaign": "campaign name", "dates": "its dates", "rule": "the goal, target, promo or legal rule that applies, from B" } ],
  "local_plays": [ { "action": "what to do", "local_hook": "the concrete local detail from A", "playbook_support": "promo/goal/date from B, or empty" } ],
  "heads_up": ""
}
Use 1-3 playbook_rules and 3-5 local_plays.

${BRAND_RULES}

STORE:
${storeText}

${section('A) LOCAL DATA', by('local'))}

${section('B) PLAYBOOK KEY FACTS', by('facts'))}

${section('C) PLAYBOOK EXCERPTS', by('excerpt'))}`;

  const messages = [{ role: 'system', content: system }, { role: 'user', content: userQuery }];
  let text = await generateCompletion(messages, { json: true });

  // Automatic brand check: one rewrite pass if a banned phrase slipped in.
  const violations = findBrandViolations(text);
  if (violations.length) {
    text = await generateCompletion([
      ...messages,
      { role: 'assistant', content: text },
      { role: 'user', content: `Rewrite the JSON without these banned phrases: ${violations.join(', ')}. Keep everything else the same.` }
    ], { json: true });
  }

  const [pbRows] = await pool.execute('SELECT quarter, year FROM playbooks WHERE is_active = 1 LIMIT 1');
  const pb = pbRows[0];
  return {
    answer: normalizeAnswer(text),
    sources: context.map((c) => ({
      id: c.id, kind: c.kind, chunkType: c.chunkType, quarter: c.quarter,
      heading: c.metadata?.heading ?? null, score: Number(c.score.toFixed(3)), content: c.content.slice(0, 1500)
    })),
    counts: { local: by('local').length, facts: by('facts').length, excerpt: by('excerpt').length, total: context.length },
    model: CHAT_MODEL,
    playbook: pb ? { quarter: pb.quarter, year: pb.year, label: `Q${pb.quarter} ${pb.year}` } : null,
    store: { location_id: store.location_id, name: store.name, city: store.city, state: store.state }
  };
}
