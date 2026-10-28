// Hostinger kills HTTP requests after 120s, so every long operation gets a hard cap below that.
export const MAX_OPERATION_MS = 100_000;

export function withTimeout(promise, ms = MAX_OPERATION_MS, label = 'Operation') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
