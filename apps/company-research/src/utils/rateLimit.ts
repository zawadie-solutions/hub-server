/** Request pacing and backoff. These slow the tool down; they never try to evade limits. */

export const realSleep = (seconds: number) => new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, seconds) * 1000));
export const monotonic = () => performance.now() / 1000;

/** Minimum delay between the starts of consecutive requests (shared by concurrent workers). */
export class RateLimiter {
  readonly minDelay: number;
  private nextAllowed = 0;

  constructor(
    minDelay = 1.0,
    private sleep: (seconds: number) => unknown = realSleep,
    private clock: () => number = monotonic,
  ) {
    this.minDelay = Math.max(0, minDelay);
  }

  /** Wait for the next request slot; resolves with the time waited. */
  async wait(): Promise<number> {
    const now = this.clock();
    const start = Math.max(now, this.nextAllowed);
    this.nextAllowed = start + this.minDelay;
    const waited = start - now;
    if (waited > 0) await this.sleep(waited);
    return waited;
  }
}

/** Exponential backoff with jitter. A server-provided Retry-After always wins. */
export function backoffDelay(attempt: number, base = 1.0, cap = 60.0, retryAfter?: number | null): number {
  if (retryAfter != null && retryAfter > 0) return Math.min(retryAfter, cap);
  const delay = Math.min(cap, base * 2 ** attempt);
  return delay + Math.random() * delay * 0.25;
}
