/** Email provider interfaces: Hunter/ZeroBounce HTTP mapping, the built-in verifier, mocks. */
import dns from "node:dns";
import { afterEach, describe, expect, it } from "vitest";
import { QuotaExceededError, RateLimitError, TransientProviderError } from "../src/providers/base";
import { CATCH_ALL, DISPOSABLE, emailMatch, INVALID, ROLE_BASED, UNKNOWN, VALID } from "../src/providers/emailBase";
import { BuiltinEmailVerifier, HunterProvider, KNOWN_DISPOSABLE_DOMAINS, MockEmailDiscoveryProvider, MockEmailVerificationProvider, ZeroBounceProvider } from "../src/providers/emailProviders";

const KEYS = ["HUNTER_API_KEY", "EMAIL_VERIFICATION_API_KEY"];
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k];
  else process.env[k] = v;
});

const fetchReturning = (status: number, body: unknown, check?: (url: URL) => void) =>
  (async (url: URL) => {
    check?.(url);
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  }) as unknown as typeof fetch;

const hunterWith = (status: number, body: unknown, check?: (url: URL) => void) => {
  process.env.HUNTER_API_KEY = "k";
  return new HunterProvider(fetchReturning(status, body, check));
};
const zerobounceWith = (status: number, body: unknown) => {
  process.env.EMAIL_VERIFICATION_API_KEY = "k";
  return new ZeroBounceProvider(fetchReturning(status, body));
};

describe("Hunter discovery", () => {
  it("parses a domain search", async () => {
    const provider = hunterWith(
      200,
      {
        data: {
          emails: [
            { value: "john@abc.com", type: "personal", confidence: 92, first_name: "John", last_name: "Smith", position: "Owner", department: "Executive", sources: [{ uri: "https://abc.com/about", domain: "abc.com" }] },
            { value: "info@abc.com", type: "generic", confidence: 80, sources: [] },
          ],
        },
      },
      (url) => {
        expect(url.searchParams.get("domain")).toBe("abc.com");
        expect(url.searchParams.get("api_key")).toBe("k");
      },
    );
    const matches = await provider.searchDomain("abc.com");
    expect(matches[0]).toEqual(
      emailMatch({ email: "john@abc.com", firstName: "John", lastName: "Smith", fullName: "John Smith", title: "Owner", department: "Executive", emailType: "personal", providerConfidence: 92, sourceUrl: "https://abc.com/about", sourceTitle: "abc.com" }),
    );
    expect(matches[1].emailType).toBe("generic");
  });

  it("needs a domain or company to find a person", async () => {
    expect(await hunterWith(200, { data: {} }).findByName("John", "Smith")).toEqual([]);
  });

  it("parses a person match", async () => {
    const provider = hunterWith(200, { data: { email: "john@abc.com", score: 90, sources: [{ uri: "https://abc.com/team" }] } }, (url) => {
      expect(url.searchParams.get("first_name")).toBe("John");
      expect(url.searchParams.get("domain")).toBe("abc.com");
    });
    expect(await provider.findByName("John", "Smith", "abc.com")).toEqual([
      emailMatch({ email: "john@abc.com", firstName: "John", lastName: "Smith", fullName: "John Smith", emailType: "personal", providerConfidence: 90, sourceUrl: "https://abc.com/team" }),
    ]);
  });

  it("returns nothing when there is no match", async () => {
    expect(await hunterWith(200, { data: { email: null } }).findByName("John", "Smith", "abc.com")).toEqual([]);
  });
});

describe("Hunter verification", () => {
  it.each([
    [{ status: "valid", result: "deliverable", regexp: true, mx_records: true, smtp_check: true, role: false, disposable: false, accept_all: false }, VALID],
    [{ status: "invalid", result: "undeliverable", role: false, disposable: false, accept_all: false }, INVALID],
    [{ status: "unknown", result: "risky", role: false, disposable: false, accept_all: false }, "Risky"],
    [{ status: "valid", result: "deliverable", role: true, disposable: false, accept_all: false }, ROLE_BASED],
    [{ status: "accept_all", result: "unknown", role: false, disposable: false, accept_all: true }, CATCH_ALL],
    [{ status: "disposable", result: "undeliverable", role: false, disposable: true, accept_all: false }, DISPOSABLE],
  ])("maps %o", async (data, expected) => {
    const result = await hunterWith(200, { data }).verify("john@abc.com");
    expect(result.status).toBe(expected);
    expect(result.provider).toBe("hunter");
    expect(result.raw).toEqual(data);
  });

  it("never claims a mailbox check it did not get", async () => {
    const result = await hunterWith(200, { data: { status: "unknown", result: "unknown", role: false, disposable: false, accept_all: false } }).verify("x@abc.com");
    expect(result.mailbox_check).toBe("not_available"); // smtp_check was absent from the response
  });

  it.each([
    [429, RateLimitError],
    [500, TransientProviderError],
    [402, QuotaExceededError],
  ] as const)("maps HTTP %i", async (status, expected) => {
    await expect(hunterWith(status, { errors: [{ details: "x" }] }).searchDomain("abc.com")).rejects.toBeInstanceOf(expected);
  });

  it("is unconfigured without a key", () => {
    delete process.env.HUNTER_API_KEY;
    expect(new HunterProvider().isConfigured()).toBe(false);
  });
});

describe("ZeroBounce", () => {
  it.each([
    [{ status: "valid", sub_status: "", mx_found: "true" }, VALID],
    [{ status: "invalid", sub_status: "invalid_syntax", mx_found: "false" }, INVALID],
    [{ status: "catch-all", sub_status: "", mx_found: "true" }, CATCH_ALL],
    [{ status: "do_not_mail", sub_status: "spamtrap", mx_found: "true" }, "Risky"],
    [{ status: "unknown", sub_status: "disposable", mx_found: "true" }, DISPOSABLE],
    [{ status: "valid", sub_status: "role_based", mx_found: "true" }, ROLE_BASED],
  ])("maps %o", async (data, expected) => {
    const result = await zerobounceWith(200, data).verify("a@b.com");
    expect(result.status).toBe(expected);
    expect(result.provider).toBe("zerobounce");
  });

  it("reports exhausted credits as a quota error", async () => {
    await expect(zerobounceWith(400, "credits exhausted").verify("a@b.com")).rejects.toBeInstanceOf(QuotaExceededError);
  });
});

describe("built-in verifier", () => {
  const dnsError = (code: string) => Object.assign(new Error(code), { code });
  const withMx = (has = true) => new BuiltinEmailVerifier(async () => (has ? [{ exchange: "mx.example.com", priority: 10 }] : []));
  const failing = (code: string) =>
    new BuiltinEmailVerifier(async () => {
      throw dnsError(code);
    });

  it("rejects bad syntax", async () => {
    const result = await new BuiltinEmailVerifier().verify("not-an-email");
    expect(result.status).toBe(INVALID);
    expect(result.syntax_check).toBe("failed");
  });

  it("rejects a malformed domain", async () => {
    const result = await new BuiltinEmailVerifier().verify("john@-bad-.com");
    expect(result.status).toBe(INVALID);
    expect(result.domain_check).toBe("failed");
  });

  it("calls a domain with no mail server invalid", async () => {
    const result = await failing(dns.NOTFOUND).verify("john@nowhere-example-xyz.test");
    expect(result.status).toBe(INVALID);
    expect(result.mx_check).toBe("failed");
  });

  it("flags role-based mailboxes", async () => {
    const result = await withMx().verify("info@example.com");
    expect(result.status).toBe(ROLE_BASED);
    expect(result.role_based_status).toBe("role_based");
  });

  it("flags disposable domains", async () => {
    expect((await withMx().verify(`john@${[...KNOWN_DISPOSABLE_DOMAINS][0]}`)).status).toBe(DISPOSABLE);
  });

  it("never claims a valid mailbox", async () => {
    // Core accuracy rule: syntax+domain+MX all passing must still stop at Unknown, not Valid.
    const result = await withMx().verify("john@example.com");
    expect(result.status).toBe(UNKNOWN);
    expect(result.mailbox_check).toBe("not_available");
    expect(result.error.toLowerCase()).toContain("not verified");
  });

  it("does not penalise a DNS failure", async () => {
    const result = await failing(dns.TIMEOUT).verify("john@example.com");
    expect(result.mx_check).toBe("not_available");
    expect(result.status).not.toBe(INVALID);
  });
});

describe("mock email providers", () => {
  it("discovery is labelled and deterministic", async () => {
    const provider = new MockEmailDiscoveryProvider();
    const first = await provider.searchDomain("acme.example");
    expect(await provider.searchDomain("acme.example")).toEqual(first);
    expect(first.length).toBeGreaterThanOrEqual(1);
    expect(first.every((m) => m.sourceTitle.startsWith("[DEMO]"))).toBe(true);
    expect(provider.isDemo).toBe(true);
  });

  it("verification covers several statuses", async () => {
    const provider = new MockEmailVerificationProvider();
    const statuses = new Set(await Promise.all(Array.from({ length: 20 }, async (_, i) => (await provider.verify(`user${i}@example.com`)).status)));
    expect(statuses.size).toBeGreaterThan(1); // deterministic but varied
    expect(provider.isDemo).toBe(true);
  });
});
