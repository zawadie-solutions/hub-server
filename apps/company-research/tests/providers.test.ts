/** SearchProvider: valid results, failure handling, retries/backoff and fallback. */
import { afterEach, describe, expect, it } from "vitest";
import { AllProvidersFailed, ProviderError, ProviderNotConfigured, QuotaExceededError, RateLimitError, type SearchProvider, type SearchResult, TransientProviderError } from "../src/providers/base";
import { type SearchEvent, SearchManager } from "../src/providers/manager";
import { MockProvider } from "../src/providers/mock";
import { buildChain } from "../src/providers/registry";
import { BingProvider, BraveProvider, GoogleProvider, SerpApiProvider } from "../src/providers/webSearch";
import { backoffDelay, RateLimiter } from "../src/utils/rateLimit";

const KEYS = ["GOOGLE_API_KEY", "GOOGLE_SEARCH_ENGINE_ID", "BING_API_KEY", "SERPAPI_KEY", "BRAVE_API_KEY"];
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
const setEnv = (values: Record<string, string>) => {
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, values);
};
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k];
  else process.env[k] = v;
});

class FakeProvider implements SearchProvider {
  readonly label: string;
  readonly isDemo = false;
  readonly requiredEnv = [];
  calls = 0;
  constructor(
    readonly name: string,
    private errors: Error[] = [],
  ) {
    this.label = name;
  }
  isConfigured() {
    return true;
  }
  async search(query: string): Promise<SearchResult[]> {
    this.calls++;
    if (this.errors.length) throw this.errors.shift();
    return [{ title: `${this.name} hit`, url: "https://example.org/", snippet: query, source: this.name, displayUrl: "" }];
  }
}

function manager(providers: SearchProvider[], opts: { maxRetries?: number; onEvent?: (e: SearchEvent) => void } = {}) {
  const waits: number[] = [];
  return [new SearchManager(providers, { ...opts, sleep: (s) => waits.push(s) }), waits] as const;
}

const jsonFetch = (status: number, body: unknown, headers: Record<string, string> = {}, check?: (url: URL) => void) =>
  (async (url: URL) => {
    check?.(url);
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });
  }) as unknown as typeof fetch;

describe("search providers", () => {
  it("mock returns valid results", async () => {
    const results = await new MockProvider().search('"ABC Roofing" Portland Oregon', 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(5);
    for (const r of results) {
      expect(r.title.startsWith("[DEMO]") && r.url.startsWith("https://") && r.snippet).toBeTruthy();
      expect(r.source).toBe("mock");
    }
  });

  it("mock site: query stays on that site", async () => {
    const provider = new MockProvider();
    await provider.search('"ABC Roofing" Portland Oregon');
    const results = await provider.search("site:abc-roofing.example owner");
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.url.includes("abc-roofing.example"))).toBe(true);
  });

  it("google parses results", async () => {
    setEnv({ GOOGLE_API_KEY: "k", GOOGLE_SEARCH_ENGINE_ID: "cx" });
    const fetchImpl = jsonFetch(200, { items: [{ title: "Acme", link: "https://acme.com/", snippet: "Acme Co", displayLink: "acme.com" }] }, {}, (url) => {
      expect(url.searchParams.get("q")).toBe("acme");
      expect(url.searchParams.get("num")).toBe("10");
    });
    expect(await new GoogleProvider(fetchImpl).search("acme", 25)).toEqual([{ title: "Acme", url: "https://acme.com/", snippet: "Acme Co", source: "google", displayUrl: "acme.com" }]);
  });

  it.each([
    [BingProvider, "BING_API_KEY", { webPages: { value: [{ name: "Acme", url: "https://acme.com/", snippet: "Acme Co", displayUrl: "acme.com" }] } }],
    [SerpApiProvider, "SERPAPI_KEY", { organic_results: [{ title: "Acme", link: "https://acme.com/", snippet: "Acme Co", displayed_link: "acme.com" }] }],
    [BraveProvider, "BRAVE_API_KEY", { web: { results: [{ title: "<strong>Acme</strong>", url: "https://acme.com/", description: "Acme <strong>Co</strong>" }] } }],
  ] as const)("%o returns the same structure", async (Cls, env, payload) => {
    setEnv({ [env]: "k" });
    const provider = new Cls(jsonFetch(200, payload));
    expect(await provider.search("acme")).toEqual([{ title: "Acme", url: "https://acme.com/", snippet: "Acme Co", source: provider.name, displayUrl: "acme.com" }]);
  });

  it.each([
    [429, "", RateLimitError],
    [503, "", TransientProviderError],
    [403, '{"error": {"message": "Daily Limit Exceeded: quota"}}', QuotaExceededError],
    [400, "bad request", ProviderError],
  ] as const)("google maps HTTP %i", async (status, body, expected) => {
    setEnv({ GOOGLE_API_KEY: "k", GOOGLE_SEARCH_ENGINE_ID: "cx" });
    const err = await new GoogleProvider(jsonFetch(status, body, { "Retry-After": "7" })).search("acme").catch((e) => e);
    expect(err).toBeInstanceOf(expected);
    if (expected === RateLimitError) expect(err.retryAfter).toBe(7);
  });

  it("an unconfigured provider refuses to search", async () => {
    setEnv({ GOOGLE_API_KEY: "" });
    const provider = new GoogleProvider();
    expect(provider.isConfigured()).toBe(false);
    await expect(provider.search("acme")).rejects.toBeInstanceOf(ProviderNotConfigured);
  });
});

describe("search manager", () => {
  it("handles a provider failure", async () => {
    const [m] = manager([new FakeProvider("broken", [new ProviderError("boom")])]);
    const err = await m.search("acme").catch((e) => e);
    expect(err).toBeInstanceOf(AllProvidersFailed);
    expect(err.message).toContain("broken: boom");
  });

  it("uses and records the fallback provider", async () => {
    const events: SearchEvent[] = [];
    const [m] = manager([new FakeProvider("google", [new ProviderError("HTTP 400")]), new FakeProvider("bing")], { onEvent: (e) => events.push(e) });
    expect((await m.search("acme"))[0].source).toBe("bing");
    expect(events.map((e) => e.kind)).toEqual(["provider_failed", "search_ok"]);
  });

  it("retries a rate limit with backoff, then succeeds", async () => {
    const provider = new FakeProvider("google", [new RateLimitError("429", 5), new RateLimitError("429")]);
    const [m, waits] = manager([provider], { maxRetries: 3 });
    expect((await m.search("acme"))[0].source).toBe("google");
    expect(provider.calls).toBe(3);
    expect(waits[0]).toBe(5); // Retry-After honoured, then exponential backoff
    expect(waits).toHaveLength(2);
  });

  it("falls back and cools down once retries are exhausted", async () => {
    const limited = new FakeProvider("google", Array.from({ length: 10 }, () => new RateLimitError("429")));
    const [m] = manager([limited, new FakeProvider("bing")], { maxRetries: 2 });
    expect((await m.search("one"))[0].source).toBe("bing");
    expect(limited.calls).toBe(3); // 1 try + 2 retries, never more
    expect((await m.search("two"))[0].source).toBe("bing");
    expect(limited.calls).toBe(3); // still cooling down: not hammered again
  });

  it("never retries an exhausted quota", async () => {
    const provider = new FakeProvider("google", [new QuotaExceededError("quota")]);
    const [m, waits] = manager([provider, new FakeProvider("serpapi")]);
    expect((await m.search("acme"))[0].source).toBe("serpapi");
    expect(provider.calls).toBe(1);
    expect(waits).toEqual([]);
  });

  it("spaces requests", async () => {
    let now = 0;
    const sleeps: number[] = [];
    const limiter = new RateLimiter(
      1.0,
      (s) => {
        sleeps.push(s);
        now += s;
      },
      () => now,
    );
    for (let i = 0; i < 3; i++) await limiter.wait();
    expect(sleeps).toEqual([1.0, 1.0]);
  });

  it("grows backoff and caps it", () => {
    const d0 = backoffDelay(0);
    expect(d0 >= 1 && d0 <= 1.25).toBe(true);
    const d2 = backoffDelay(2);
    expect(d2 >= 4 && d2 <= 5).toBe(true);
    expect(backoffDelay(20, 1, 60)).toBeLessThanOrEqual(75);
    expect(backoffDelay(0, 1, 60, 120)).toBe(60);
  });
});

describe("provider chain", () => {
  it("is demo mode without credentials", () => {
    setEnv({});
    const [chain, demo] = buildChain({ default_provider: "google", secondary_provider: "bing", providers: { google: { enabled: true } } });
    expect(demo).toBe(true);
    expect(chain.map((p) => p.name)).toEqual(["mock"]);
  });

  it("never mixes mock into a live chain", () => {
    setEnv({ SERPAPI_KEY: "k", BRAVE_API_KEY: "k" });
    const [chain, demo] = buildChain({ default_provider: "brave", secondary_provider: "serpapi", providers: { mock: { enabled: true } } });
    expect(demo).toBe(false);
    expect(chain.map((p) => p.name)).toEqual(["brave", "serpapi"]);
  });
});
