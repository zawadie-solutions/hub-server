import pool from '../config/db.js';
import { ingestPlaybook, listPlaybooks, setActivePlaybook } from '../services/playbookService.js';
import { generateEmbedding, generateLocalizedResult, getStoreProfile, insertChunk } from '../services/ragService.js';
import { createJob, updateJob, getJob } from '../services/jobService.js';
import { listStores, storeExists, createStore, updateStore, deleteStore } from '../services/storeService.js';
import { queueResearch, queueStaleResearch, effectiveStatus, workerActive, kickWorkerIfLocal, AUTO_SOURCE } from '../services/localResearchService.js';
import { withTimeout, MAX_OPERATION_MS } from '../utils/timeout.js';
import { planMode, eventPlanOutput } from './askController.js';

const KNOWLEDGE_TYPES = ['demographic', 'school', 'event', 'community', 'culture'];
const parseJson = (v) => { try { return v == null ? null : typeof v === 'string' ? JSON.parse(v) : v; } catch { return null; } };   // MySQL returns objects, MariaDB strings

/** Public: lets the admin UI show Online / Database status. Reveals nothing else. */
export async function health(req, res) {
  let database = 'connected';
  try { await withTimeout(pool.query('SELECT 1'), 5000, 'Database ping'); } catch { database = 'error'; }
  res.json({ status: database === 'connected' ? 'ok' : 'degraded', database });
}

/** Everything the admin dashboard needs in one request. */
export async function getOverview(req, res, next) {
  try {
    const [playbooks] = await pool.execute(
      `SELECT p.id, p.quarter, p.year, p.is_active, p.filename, p.uploaded_at,
              (SELECT COUNT(*) FROM knowledge_chunks c WHERE c.playbook_id = p.id) AS chunk_count
         FROM playbooks p ORDER BY p.year DESC, p.quarter DESC, p.id DESC`
    );
    const [stores] = await pool.execute('SELECT * FROM stores ORDER BY id');
    const active = await workerActive();
    const [chunks] = await pool.execute(
      'SELECT id, location_id, chunk_type, content, metadata, created_at FROM knowledge_chunks WHERE location_id IS NOT NULL AND is_active = 1 ORDER BY id'
    );
    const chunksFor = (id) => chunks.filter((c) => c.location_id === id).map(({ metadata, ...c }) => {
      const m = parseJson(metadata) ?? {};
      const auto = m.source === AUTO_SOURCE;
      return { ...c, auto, ...(auto && { web: !!m.web, sources: Array.isArray(m.sources) ? m.sources.slice(0, 8) : [] }), reviewed_by: m.reviewed_by ?? null, reviewed_at: m.reviewed_at ?? null };
    });
    res.json({
      database: 'connected',
      activePlaybook: playbooks.find((p) => p.is_active) ?? null,
      playbooks,
      stores: stores.map((s) => ({
        location_id: s.location_id, name: s.name, address: s.address, city: s.city, state: s.state, zip: s.zip,
        research_status: effectiveStatus(s, active), research_error: s.research_error ?? null, researched_at: s.researched_at ?? null, research_queued_at: s.research_queued_at ?? null,
        chunks: chunksFor(s.location_id)
      }))
    });
  } catch (err) { next(err); }
}

/**
 * Starts playbook processing and returns immediately (202) with a job id; the UI polls /admin/jobs/:id for
 * real progress. Work is request-triggered (no daemon), capped at 100s, and one upload runs at a time.
 * Large playbooks should use `npm run ingest` instead.
 */
export async function uploadPlaybook(req, res, next) {
  try {
    const quarter = Number(req.body.quarter);
    const year = Number(req.body.year);
    if (!req.file || !(quarter >= 1 && quarter <= 4) || !(year >= 2000)) {
      return res.status(400).json({ error: 'Choose a PDF, a quarter (1-4) and a year.' });
    }
    const job = createJob();
    if (!job) return res.status(409).json({ error: 'Another playbook is still processing. Please wait a moment.' });
    res.status(202).json({ jobId: job.id });

    ingestPlaybook(req.file.buffer, {
      filename: req.file.originalname, quarter, year, deadlineMs: 100_000,
      onProgress: (event) => updateJob(job.id, event)
    })
      .then((result) => {
        updateJob(job.id, { status: 'done', stage: 'done', result });
        // A new playbook may mean a new quarter: queue stores whose research is older than it (the cron worker does the work).
        queueStaleResearch().then((n) => n && kickWorkerIfLocal()).catch(() => {});
      })
      .catch((err) => {
        console.error('Playbook ingestion failed:', err);
        updateJob(job.id, { status: 'error', error: String(err.message || 'Processing failed.').slice(0, 200) });
      });
  } catch (err) { next(err); }
}

export function getJobStatus(req, res) {
  const job = getJob(req.params.id);
  return job ? res.json(job) : res.status(404).json({ error: 'Job not found (it may have expired).' });
}

export async function getPlaybooks(req, res, next) {
  try { res.json(await listPlaybooks()); } catch (err) { next(err); }
}

export async function activatePlaybook(req, res, next) {
  try { await setActivePlaybook(Number(req.params.id)); res.json({ ok: true }); } catch (err) { next(err); }
}

/** Add one local knowledge chunk (demographics / school calendar / event) for a store. */
export async function addKnowledge(req, res, next) {
  try {
    const { location_id, chunk_type, content, metadata } = req.body;
    if (!(await storeExists(location_id)) || !KNOWLEDGE_TYPES.includes(chunk_type) || !content?.trim()) {
      return res.status(400).json({ error: `Need location_id, chunk_type (${KNOWLEDGE_TYPES.join('|')}) and content.` });
    }
    if (!(await getStoreProfile(location_id))) return res.status(400).json({ error: 'Store not found in database.' });
    const embedding = await withTimeout(generateEmbedding(content), 60_000, 'Embedding');
    const id = await insertChunk({ locationId: location_id, chunkType: chunk_type, content: content.trim(), embedding, metadata });
    res.json({ ok: true, id });
  } catch (err) { next(err); }
}

/** Only store-specific chunks can be removed here; playbook chunks are managed through playbooks. */
export async function deleteKnowledge(req, res, next) {
  try {
    const [result] = await pool.execute('DELETE FROM knowledge_chunks WHERE id = ? AND location_id IS NOT NULL', [Number(req.params.id)]);
    res.json({ ok: result.affectedRows > 0 });
  } catch (err) { next(err); }
}

/** Exercise the full RAG pipeline without the planner page. Returns the structured answer plus the retrieved context. */
export async function testQuery(req, res, next) {
  try {
    const { location_id, question } = req.body;
    if (!(await storeExists(location_id)) || !question?.trim() || question.length > 500) {
      return res.status(400).json({ error: 'Choose a store and a question up to 500 characters.' });
    }
    const result = await withTimeout(generateLocalizedResult(question.trim(), location_id, { mode: planMode(req.body.mode) }), MAX_OPERATION_MS, 'Response generation');
    res.json(result.type === 'event_plan' ? { ...result, ...eventPlanOutput(result, { slack: true }) } : result);
  } catch (err) { next(err); }
}

/**
 * Add a store (name, address, city, state and ZIP are all required). It appears in the admin and the marketing planner
 * immediately and is queued for the AI to research its community, demographics, schools, events and culture
 * (the cron worker, scripts/runResearch.js, picks it up within a few minutes).
 */
export async function addStore(req, res, next) {
  try {
    const store = await createStore(req.body);
    store.research_status = (await queueResearch(store.location_id)) ? 'pending' : 'none';
    kickWorkerIfLocal();
    res.status(201).json({ ok: true, store });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

/** Change a store's details. With research: true the AI is also queued to re-research its community (useful when the city, state or ZIP changed). */
export async function patchStore(req, res, next) {
  try {
    const store = await updateStore(req.params.id, req.body);
    let research_status = null;
    if (req.body?.research === true && (await queueResearch(store.location_id))) { research_status = 'pending'; kickWorkerIfLocal(); }
    res.json({ ok: true, store, research_status });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

/** Delete a store and everything the agent knows about it. */
export async function removeStore(req, res, next) {
  try {
    const [[row]] = await pool.query('SELECT research_status FROM stores WHERE location_id = ?', [req.params.id]);
    if (row?.research_status === 'running' && (await workerActive())) return res.status(409).json({ error: 'Research is running for this store right now. Try again in a minute.' });
    res.json({ ok: await deleteStore(req.params.id) });
  } catch (err) { next(err); }
}

/** Mark an entry as checked by a person (reviewed: true) or clear the mark (reviewed: false). */
export async function reviewKnowledge(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Bad id.' });
    const [result] = req.body?.reviewed === false
      ? await pool.execute("UPDATE knowledge_chunks SET metadata = JSON_REMOVE(metadata, '$.reviewed_by', '$.reviewed_at') WHERE id = ? AND location_id IS NOT NULL", [id])
      : await pool.execute(
          "UPDATE knowledge_chunks SET metadata = JSON_SET(COALESCE(metadata, '{}'), '$.reviewed_by', ?, '$.reviewed_at', ?) WHERE id = ? AND location_id IS NOT NULL",
          [req.hubUser?.email ?? 'admin key', new Date().toISOString(), id]
        );
    res.json({ ok: result.affectedRows > 0 });
  } catch (err) { next(err); }
}

/** Queue the automatic local research for an existing store. When it runs, earlier auto-researched entries are replaced; hand-entered ones are kept. */
export async function researchStore(req, res, next) {
  try {
    const store = (await listStores()).find((s) => s.location_id === req.params.id);
    if (!store) return res.status(404).json({ error: 'Store not found.' });
    if (!(await queueResearch(store.location_id))) return res.status(409).json({ error: 'Research for this store is already queued or running.' });
    kickWorkerIfLocal();
    res.status(202).json({ ok: true, research_status: 'pending' });
  } catch (err) { next(err); }
}
