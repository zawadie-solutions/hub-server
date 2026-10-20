/**
 * The SearchProvider interface.
 *
 * The research engine only ever talks to this interface. To add a search engine, implement
 * SearchProvider (or extend HttpSearchProvider) and register it in providers/registry.ts.
 */
import { envValue } from "../config";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string; // name of the provider that produced this result
  displayUrl: string;
  /** The query that found it (set by the code that ran the search; used for frequency scoring). */
  query?: string;
}

export const searchResult = (r: Omit<SearchResult, "displayUrl"> & { displayUrl?: string }): SearchResult => ({ displayUrl: "", ...r });

/** A provider could not return results. Not retried unless a subclass says so. */
export class ProviderError extends Error {
  retryable = false;
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class ProviderNotConfigured extends ProviderError {}

/** Timeouts, connection problems and 5xx responses. */
export class TransientProviderError extends ProviderError {
  retryable = true;
}

/** HTTP 429. Retried with backoff, honouring Retry-After. */
export class RateLimitError extends ProviderError {
  retryable = true;
  constructor(
    message: string,
    readonly retryAfter: number | null = null,
  ) {
    super(message);
  }
}

/** The API quota is used up; retrying will not help until it resets. */
export class QuotaExceededError extends ProviderError {}

export class AllProvidersFailed extends ProviderError {}

export interface SearchProvider {
  readonly name: string;
  readonly label: string;
  readonly isDemo: boolean;
  readonly requiredEnv: readonly string[];
  isConfigured(): boolean;
  /** Up to numResults results for query, or rejects with a ProviderError. */
  search(query: string, numResults?: number): Promise<SearchResult[]>;
}

export const allEnvSet = (keys: readonly string[]) => keys.every((key) => envValue(key).trim());

export type FetchImpl = typeof fetch;

/** GET a JSON API and map its status codes onto ProviderErrors (shared by every HTTP provider). */
export async function getJson(
  fetchImpl: FetchImpl,
  label: string,
  url: string,
  params: Record<string, string | number>,
  opts: { headers?: Record<string, string>; timeoutSeconds?: number; notConfiguredOn401?: boolean } = {},
): Promise<any> {
  const target = new URL(url);
  for (const [k, v] of Object.entries(params)) target.searchParams.set(k, String(v));
  let response: Response;
  try {
    response = await fetchImpl(target, { headers: opts.headers, signal: AbortSignal.timeout((opts.timeoutSeconds ?? 20) * 1000) });
  } catch (e) {
    const err = e as Error;
    if (err.name === "TimeoutError" || err.name === "AbortError") throw new TransientProviderError(`${label}: request timed out`);
    throw new TransientProviderError(`${label}: network error (${err.name})`);
  }
  const status = response.status;
  if (status === 429) {
    const retryAfter = Number.parseFloat(response.headers.get("Retry-After") ?? "");
    throw new RateLimitError(`${label}: 429 Too Many Requests`, Number.isFinite(retryAfter) ? retryAfter : null);
  }
  if (status >= 500) throw new TransientProviderError(`${label}: server error ${status}`);
  // The email APIs (Hunter, ZeroBounce) report a bad key as 401/403 and speak of "credits".
  const emailApi = Boolean(opts.notConfiguredOn401);
  if (emailApi && (status === 401 || status === 403)) throw new ProviderNotConfigured(`${label}: API key was rejected (HTTP ${status})`);
  if (status >= 400) {
    const text = await response.text().catch(() => "");
    const detail = text.slice(0, 300).toLowerCase();
    if (detail.includes("quota") || detail.includes("limit") || (emailApi && detail.includes("credits")) || status === 402) {
      throw new QuotaExceededError(`${label}: ${emailApi ? "quota exceeded" : "API quota exceeded"} (HTTP ${status})`);
    }
    throw new ProviderError(`${label}: request rejected (HTTP ${status})${emailApi ? `: ${text.slice(0, 200)}` : ""}`);
  }
  try {
    return await response.json();
  } catch {
    throw new ProviderError(`${label}: response was not valid JSON`);
  }
}

/** Shared plumbing: one GET per search, refusing to run without credentials. */
export abstract class HttpSearchProvider implements SearchProvider {
  abstract readonly name: string;
  abstract readonly label: string;
  readonly isDemo = false;
  abstract readonly requiredEnv: readonly string[];
  protected timeoutSeconds = 20;

  constructor(protected fetchImpl: FetchImpl = fetch) {}

  isConfigured(): boolean {
    return allEnvSet(this.requiredEnv);
  }

  protected getJson(url: string, params: Record<string, string | number>, headers?: Record<string, string>): Promise<any> {
    if (!this.isConfigured()) throw new ProviderNotConfigured(`${this.label}: API credentials are missing`);
    return getJson(this.fetchImpl, this.label, url, params, { headers, timeoutSeconds: this.timeoutSeconds });
  }

  abstract search(query: string, numResults?: number): Promise<SearchResult[]>;
}
