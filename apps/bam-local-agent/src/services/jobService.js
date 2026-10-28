// Tiny in-memory job tracker so the admin UI can poll real ingestion progress.
// Jobs are short-lived (< 2 min) and lost on restart, which is fine for a one-off upload.
import crypto from 'crypto';

const jobs = new Map();
const KEEP_MS = 30 * 60 * 1000;
const STALE_RUNNING_MS = 5 * 60 * 1000;

function purge() {
  const now = Date.now();
  for (const [id, j] of jobs) if (now - j.startedAt > KEEP_MS) jobs.delete(id);
}

/** Returns a new job, or null if another job is still running (one playbook at a time). */
export function createJob() {
  purge();
  const now = Date.now();
  for (const j of jobs.values()) if (j.status === 'running' && now - j.startedAt < STALE_RUNNING_MS) return null;
  const job = { id: crypto.randomBytes(8).toString('hex'), status: 'running', stage: 'queued', done: 0, total: 0, startedAt: now };
  jobs.set(job.id, job);
  return job;
}

export const updateJob = (id, patch) => { const j = jobs.get(id); if (j) Object.assign(j, patch); };
export const getJob = (id) => jobs.get(id) ?? null;
