import { createRequire } from 'module';
import path from 'path';
import pool from '../config/db.js';
import { generateEmbeddings, insertChunk } from './ragService.js';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse/lib/pdf-parse.js'); // direct path avoids pdf-parse's debug-mode index.js

/* ---------- Text extraction & chunking ---------- */

export async function extractText(buffer, filename) {
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.pdf') return (await pdfParse(buffer)).text;
  if (ext === '.txt' || ext === '.md') return buffer.toString('utf8');
  throw new Error(`Unsupported file type "${ext}". Use .pdf, .txt or .md.`);
}

function splitLong(paragraph, maxChars) {
  const parts = paragraph.split(/(?<=[.!?])\s+|\n/).filter(Boolean);
  const out = [];
  let cur = '';
  for (let part of parts) {
    while (part.length > maxChars) { out.push(part.slice(0, maxChars)); part = part.slice(maxChars); }
    if (cur && cur.length + part.length + 1 > maxChars) { out.push(cur); cur = ''; }
    cur = cur ? `${cur} ${part}` : part;
  }
  if (cur) out.push(cur);
  return out;
}

/** Paragraph-aware chunking: keeps sections together, carries one short paragraph of overlap. */
export function chunkText(text, { maxChars = 1200, minChars = 40 } = {}) {
  const units = [];
  for (const p of text.replace(/\r/g, '').split(/\n\s*\n/)) {
    const clean = p.replace(/[ \t]+/g, ' ').trim();
    if (!clean) continue;
    units.push(...(clean.length <= maxChars ? [clean] : splitLong(clean, maxChars)));
  }
  const chunks = [];
  let cur = '', last = '', hasNew = false;
  for (const u of units) {
    if (cur && cur.length + u.length + 2 > maxChars) {
      chunks.push(cur);
      cur = last.length < 250 ? last : '';
      hasNew = false;
    }
    cur = cur ? `${cur}\n\n${u}` : u;
    last = u;
    hasNew = true;
  }
  if (cur && hasNew) chunks.push(cur);
  return chunks.filter((c) => c.length >= minChars);
}

/* ---------- Playbook records ---------- */

export const quarterTag = (year, quarter) => `${year}-Q${quarter}`;

export async function listPlaybooks() {
  const [rows] = await pool.execute('SELECT * FROM playbooks ORDER BY year DESC, quarter DESC, id DESC');
  return rows;
}

/** Make one playbook active (and its chunks searchable); all other playbooks' chunks are switched off. */
export async function setActivePlaybook(id) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute('UPDATE playbooks SET is_active = (id = ?)', [id]);
    await conn.execute('UPDATE knowledge_chunks SET is_active = (playbook_id = ?) WHERE playbook_id IS NOT NULL', [id]);
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Extract, chunk, embed and store a playbook, then activate it.
 * Chunks go in inactive; the switch to active happens only after everything succeeded,
 * so a failure or timeout never leaves a half-loaded playbook live.
 * deadlineMs: optional time budget (use < 100s for HTTP requests).
 */
export async function ingestPlaybook(buffer, { filename, quarter, year, deadlineMs = null, onProgress = null }) {
  onProgress?.({ stage: 'extracting' });
  const text = await extractText(buffer, filename);
  onProgress?.({ stage: 'chunking' });
  const chunks = chunkText(text);
  if (!chunks.length) throw new Error('No text could be extracted from the file.');
  onProgress?.({ stage: 'embedding', done: 0, total: chunks.length });

  const started = Date.now();
  const tag = quarterTag(year, quarter);
  const [result] = await pool.execute(
    'INSERT INTO playbooks (quarter, year, is_active, filename) VALUES (?, ?, 0, ?)',
    [quarter, year, filename]
  );
  const playbookId = result.insertId;

  try {
    const BATCH = 40;
    for (let i = 0; i < chunks.length; i += BATCH) {
      if (deadlineMs && Date.now() - started > deadlineMs) {
        throw new Error('Time budget exceeded. Use the CLI script (npm run ingest) for large playbooks.');
      }
      const batch = chunks.slice(i, i + BATCH);
      const vectors = await generateEmbeddings(batch);
      for (let j = 0; j < batch.length; j++) {
        await insertChunk({
          playbookId,
          chunkType: 'playbook',
          content: batch[j],
          embedding: vectors[j],
          quarter: tag,
          isActive: false,
          metadata: { source: filename, chunk_index: i + j, total_chunks: chunks.length, quarter: tag }
        });
      }
      onProgress?.({ stage: 'embedding', done: Math.min(i + BATCH, chunks.length), total: chunks.length });
    }
    onProgress?.({ stage: 'activating' });
    await setActivePlaybook(playbookId);
    onProgress?.({ stage: 'done' });
  } catch (err) {
    await pool.execute('DELETE FROM playbooks WHERE id = ?', [playbookId]); // cascades to its chunks
    throw err;
  }
  return { playbookId, quarter: tag, chunks: chunks.length };
}
