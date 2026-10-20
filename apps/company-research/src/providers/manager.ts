/**
 * SearchManager: rate limiting, retries with backoff and automatic provider fallback.
 *
 * It implements the SearchProvider interface itself, so the research engine cannot tell whether
 * it is talking to one provider or to a fallback chain.
 */
import { getLogger } from "../utils/logger";
import { backoffDelay, monotonic, RateLimiter, realSleep } from "../utils/rateLimit";
import { AllProvidersFailed, ProviderError, ProviderNotConfigured, QuotaExceededError, RateLimitError, type SearchProvider, type SearchResult } from "./base";

const log = getLogger("search");

export const QUOTA_COOLDOWN = 15 * 60; // seconds a provider is skipped after its quota is exhausted
export const FAILURE_COOLDOWN = 60; // seconds a provider is skipped after retries are exhausted

export interface SearchEvent {
  kind: string;
  provider: string;
  query: string;
  detail: string;
  time: number;
}

/** At most `size` holders at once; the rest wait in arrival order. */
export class Semaphore {
  private waiting: (() => void)[] = [];
  constructor(private free: number) {}

  async acquire(): Promise<void> {
    if (this.free > 0) {
      this.free--;
      return;
    }
    await new Promise<void>((resolve) => this.waiting.push(resolve));
  }

  release(): void {
    const next = this.waiting.shift();
    if (next) next();
    else this.free++;
  }
}

export interface ManagerOptions {
  rateLimiter?: RateLimiter;
  maxRetries?: number;
  maxConcurrent?: number;
  onEvent?: (event: SearchEvent) => void;
  sleep?: (seconds: number) => unknown;
  clock?: () => number;
  backoffBase?: number;
}

export class SearchManager implements SearchProvider {
  readonly name = "manager";
  readonly label = "Search manager";
  readonly requiredEnv = [] as const;
  readonly rateLimiter: RateLimiter;
  readonly maxRetries: number;
  private semaphore: Semaphore;
  private onEvent?: (event: SearchEvent) => void;
  private sleep: (seconds: number) => unknown;
  private clock: () => number;
  private backoffBase: number;
  private skipUntil = new Map<string, number>();

  constructor(
    readonly providers: SearchProvider[],
    opts: ManagerOptions = {},
  ) {
    this.rateLimiter = opts.rateLimiter ?? new RateLimiter(0);
    this.maxRetries = opts.maxRetries ?? 3;
    this.semaphore = new Semaphore(Math.max(1, opts.maxConcurrent ?? 3));
    this.onEvent = opts.onEvent;
    this.sleep = opts.sleep ?? realSleep;
    this.clock = opts.clock ?? monotonic;
    this.backoffBase = opts.backoffBase ?? 1.0;
  }

  get isDemo(): boolean {
    return this.providers.length > 0 && this.providers.every((p) => p.isDemo);
  }

  isConfigured(): boolean {
    return this.providers.some((p) => p.isConfigured());
  }

  private event(kind: string, provider: string, query: string, detail = ""): void {
    log.info({ kind, provider, query, detail }, "search event");
    this.onEvent?.({ kind, provider, query, detail, time: Date.now() / 1000 });
  }

  private coolDown(provider: SearchProvider, seconds: number): void {
    this.skipUntil.set(provider.name, this.clock() + seconds);
  }

  private cooling(provider: SearchProvider): boolean {
    return this.clock() < (this.skipUntil.get(provider.name) ?? 0);
  }

  async search(query: string, numResults = 10): Promise<SearchResult[]> {
    const errors: string[] = [];
    await this.semaphore.acquire();
    try {
      for (const provider of this.providers) {
        if (this.cooling(provider)) {
          errors.push(`${provider.name}: cooling down after earlier failures`);
          continue;
        }
        let results: SearchResult[];
        try {
          results = await this.searchWithRetries(provider, query, numResults);
        } catch (e) {
          if (!(e instanceof ProviderError)) throw e;
          errors.push(`${provider.name}: ${e.message}`);
          this.event("provider_failed", provider.name, query, e.message);
          continue;
        }
        this.event("search_ok", provider.name, query, `${results.length} results`);
        return results;
      }
    } finally {
      this.semaphore.release();
    }
    throw new AllProvidersFailed("All search providers failed — " + (errors.length ? errors : ["none configured"]).join("; "));
  }

  private async searchWithRetries(provider: SearchProvider, query: string, numResults: number): Promise<SearchResult[]> {
    let attempt = 0;
    for (;;) {
      await this.rateLimiter.wait();
      try {
        return await provider.search(query, numResults);
      } catch (e) {
        if (e instanceof QuotaExceededError) {
          this.coolDown(provider, QUOTA_COOLDOWN);
          throw e;
        }
        if (e instanceof ProviderNotConfigured || !(e instanceof ProviderError)) throw e;
        if (!e.retryable || attempt >= this.maxRetries) {
          if (e.retryable) this.coolDown(provider, FAILURE_COOLDOWN);
          throw e;
        }
        const delay = backoffDelay(attempt, this.backoffBase, 60, e instanceof RateLimitError ? e.retryAfter : null);
        const kind = e instanceof RateLimitError ? "rate_limited" : "retry";
        this.event(kind, provider.name, query, `${e.message}; waiting ${delay.toFixed(1)}s (attempt ${attempt + 1}/${this.maxRetries})`);
        await this.sleep(delay);
        attempt++;
      }
    }
  }
}
