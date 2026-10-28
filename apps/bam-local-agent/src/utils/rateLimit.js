// Small in-memory limiters (one Node process on shared hosting, so no Redis needed).
const windows = new Map();   // key -> [timestamps]
const failures = new Map();  // ip  -> [timestamps]

function prune(list, windowMs, now) {
  while (list.length && now - list[0] > windowMs) list.shift();
  return list;
}

/** Allows `limit` hits per `windowMs` for `key`. Returns { ok, retryAfterSec }. */
export function hit(key, limit, windowMs) {
  const now = Date.now();
  const list = prune(windows.get(key) ?? [], windowMs, now);
  if (list.length >= limit) {
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((windowMs - (now - list[0])) / 1000)) };
  }
  list.push(now);
  windows.set(key, list);
  if (windows.size > 5000) for (const [k, v] of windows) if (!prune(v, windowMs, now).length) windows.delete(k);
  return { ok: true, retryAfterSec: 0 };
}

const FAIL_LIMIT = 8;
const FAIL_WINDOW_MS = 15 * 60 * 1000;
export const isBlocked = (ip) => prune(failures.get(ip) ?? [], FAIL_WINDOW_MS, Date.now()).length >= FAIL_LIMIT;
export function recordFailure(ip) {
  const list = prune(failures.get(ip) ?? [], FAIL_WINDOW_MS, Date.now());
  list.push(Date.now());
  failures.set(ip, list);
}
export const clearFailures = (ip) => failures.delete(ip);
