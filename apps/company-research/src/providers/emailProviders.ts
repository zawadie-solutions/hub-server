/**
 * The concrete email providers: Hunter.io and ZeroBounce (optional, keyed), the free built-in
 * verifier (always available), and the Demo/Mock pair.
 */
import { createHash } from "node:crypto";
import dns from "node:dns";
import { envValue } from "../config";
import { GENERIC_LOCALS } from "../research/extraction";
import { allEnvSet, type FetchImpl, getJson } from "./base";
import {
  CATCH_ALL, DISPOSABLE, type EmailDiscoveryProvider, type EmailMatch, emailMatch, type EmailVerificationProvider, findByCompanyViaDomain, GENERIC,
  INVALID, NOT_AVAILABLE, PERSONAL, RISKY, ROLE_BASED, UNKNOWN, VALID, type VerificationResult, verificationResult,
} from "./emailBase";

// =============================================================================== Hunter.io
/**
 * Hunter.io — optional, used only when HUNTER_API_KEY is configured. One account key covers
 * both discovery (Domain Search, Email Finder) and verification (Email Verifier), all v2 REST
 * GETs (https://hunter.io/api-documentation/v2). Only what a response actually contains is used,
 * since not every endpoint is on every plan.
 */
export class HunterProvider implements EmailDiscoveryProvider, EmailVerificationProvider {
  readonly name = "hunter";
  readonly label = "Hunter.io";
  readonly isDemo = false;
  readonly requiredEnv = ["HUNTER_API_KEY"];

  constructor(private fetchImpl: FetchImpl = fetch) {}

  isConfigured() {
    return allEnvSet(this.requiredEnv);
  }

  private get(path: string, params: Record<string, string | number>) {
    return getJson(this.fetchImpl, this.label, `https://api.hunter.io/v2/${path}`, { ...params, api_key: envValue("HUNTER_API_KEY") }, { notConfiguredOn401: true });
  }

  // ------------------------------------------------------------ discovery
  async searchDomain(domain: string, limit = 25) {
    const data = await this.get("domain-search", { domain, limit: Math.max(1, Math.min(limit, 100)) });
    return ((data?.data?.emails ?? []) as any[]).map(HunterProvider.toMatch);
  }

  async findByName(firstName: string, lastName: string, domain?: string | null, companyName?: string | null) {
    if (!domain && !companyName) return [];
    const params: Record<string, string> = { first_name: firstName, last_name: lastName };
    if (domain) params.domain = domain;
    else params.company = companyName!;
    const data = (await this.get("email-finder", params))?.data ?? {};
    if (!data.email) return [];
    return [emailMatch({ email: data.email, firstName, lastName, fullName: `${firstName} ${lastName}`.trim(), emailType: PERSONAL, providerConfidence: data.score ?? null, sourceUrl: data.sources?.[0]?.uri ?? "" })];
  }

  findByCompany(_companyName: string, domain?: string | null) {
    return findByCompanyViaDomain(this, domain);
  }

  private static toMatch(item: any): EmailMatch {
    const first = item.first_name || "";
    const last = item.last_name || "";
    const source = item.sources?.[0] ?? {};
    return emailMatch({
      email: item.value ?? "",
      firstName: first,
      lastName: last,
      fullName: `${first} ${last}`.trim(),
      title: item.position || "",
      department: item.department || "",
      emailType: item.type === "personal" ? PERSONAL : GENERIC,
      providerConfidence: item.confidence ?? null,
      sourceUrl: source.uri ?? "",
      sourceTitle: source.domain ?? "",
    });
  }

  // --------------------------------------------------------- verification
  async verify(email: string): Promise<VerificationResult> {
    const data = (await this.get("email-verifier", { email }))?.data ?? {};
    const status = String(data.status || "").toLowerCase();
    const resultField = String(data.result || "").toLowerCase();
    const role = Boolean(data.role);
    const disposable = Boolean(data.disposable);
    const acceptAll = Boolean(data.accept_all);

    let overall: string;
    if (disposable) overall = DISPOSABLE;
    else if (acceptAll || status === "accept_all") overall = CATCH_ALL;
    else if (role) overall = ROLE_BASED;
    else if (status === "invalid" || resultField === "undeliverable") overall = INVALID;
    else if (status === "valid" && resultField === "deliverable") overall = VALID;
    else if (resultField === "risky") overall = RISKY;
    else overall = UNKNOWN;

    const check = (value: unknown, passedWhenTrue = true) => (value === null || value === undefined ? NOT_AVAILABLE : Boolean(value) === passedWhenTrue ? "passed" : "failed");

    return verificationResult({
      status: overall,
      syntax_check: check(data.regexp),
      domain_check: "gibberish" in data ? check(!data.gibberish) : NOT_AVAILABLE,
      mx_check: check(data.mx_records),
      mailbox_check: "smtp_check" in data ? check(data.smtp_check) : NOT_AVAILABLE,
      disposable_status: disposable ? "disposable" : "not_disposable",
      role_based_status: role ? "role_based" : "not_role_based",
      catch_all_status: acceptAll ? "catch_all" : "not_catch_all",
      provider: this.name,
      raw: data,
    });
  }
}

// ============================================================================== ZeroBounce
// ZeroBounce's own status values, mapped to our eight canonical ones.
const ZB_STATUS: Record<string, string> = { valid: VALID, invalid: INVALID, "catch-all": CATCH_ALL, spamtrap: RISKY, abuse: RISKY, do_not_mail: RISKY, unknown: UNKNOWN };

/** ZeroBounce (zerobounce.net v2 validate) — optional, used only when EMAIL_VERIFICATION_API_KEY is set. */
export class ZeroBounceProvider implements EmailVerificationProvider {
  readonly name = "zerobounce";
  readonly label = "ZeroBounce";
  readonly isDemo = false;
  readonly requiredEnv = ["EMAIL_VERIFICATION_API_KEY"];

  constructor(private fetchImpl: FetchImpl = fetch) {}

  isConfigured() {
    return allEnvSet(this.requiredEnv);
  }

  async verify(email: string): Promise<VerificationResult> {
    const data = await getJson(this.fetchImpl, this.label, "https://api.zerobounce.net/v2/validate", { api_key: envValue("EMAIL_VERIFICATION_API_KEY"), email }, { notConfiguredOn401: true });
    const status = String(data.status || "").toLowerCase();
    const subStatus = String(data.sub_status || "").toLowerCase();
    let overall = ZB_STATUS[status] ?? UNKNOWN;
    if (subStatus === "disposable") overall = DISPOSABLE;
    else if (subStatus === "role_based" || subStatus === "role_based_catch_all") overall = overall !== CATCH_ALL ? ROLE_BASED : overall;

    const mxFound = data.mx_found;
    const mxCheck = mxFound === null || mxFound === undefined ? NOT_AVAILABLE : ["true", "1"].includes(String(mxFound).toLowerCase()) ? "passed" : "failed";

    return verificationResult({
      status: overall,
      syntax_check: status !== "invalid" || subStatus !== "invalid_syntax" ? "passed" : "failed",
      domain_check: subStatus === "invalid_domain" || subStatus === "unknown_email" ? "failed" : "passed",
      mx_check: mxCheck,
      mailbox_check: status === "valid" ? "passed" : status === "invalid" ? "failed" : NOT_AVAILABLE,
      disposable_status: subStatus === "disposable" ? "disposable" : "not_disposable",
      role_based_status: subStatus.startsWith("role_based") ? "role_based" : "not_role_based",
      catch_all_status: status === "catch-all" ? "catch_all" : "not_catch_all",
      provider: this.name,
      raw: data,
      error: data.error || "",
    });
  }
}

// ========================================================================= built-in verifier
// A small, well-known set of disposable/temporary-email domains. Not exhaustive — a dedicated
// provider maintains a far larger, continuously-updated list.
export const KNOWN_DISPOSABLE_DOMAINS = new Set([
  "mailinator.com", "guerrillamail.com", "guerrillamail.net", "10minutemail.com",
  "10minutemail.net", "tempmail.com", "temp-mail.org", "throwawaymail.com", "yopmail.com",
  "trashmail.com", "getnada.com", "maildrop.cc", "fakeinbox.com", "sharklasers.com",
  "dispostable.com", "mailnesia.com", "mintemail.com", "moakt.com", "mohmal.com",
  "spamgourmet.com", "tempinbox.com", "emailondeck.com", "33mail.com", "mailcatch.com",
]);
const SYNTAX_RE = /^[A-Za-z0-9][A-Za-z0-9._%+\-]*@[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)+$/;
const DOMAIN_LABEL_RE = /^(?!-)[A-Za-z0-9-]{1,63}(?<!-)$/;
const DNS_TIMEOUT_MS = 5000;

/**
 * A real, free, local email verifier: no API key, no account, no quota. Checks syntax, domain
 * format, a live DNS MX lookup, a known-disposable-domain list and role-based (info@/sales@)
 * mailboxes. It never says a mailbox exists, and never calls an address "Valid" — only
 * "Unknown", since deliverability is still unconfirmed without a mailbox-probing provider.
 */
export class BuiltinEmailVerifier implements EmailVerificationProvider {
  readonly name = "builtin";
  readonly label = "Built-in verifier (syntax, domain, MX, disposable, role-based — free, no key)";
  readonly isDemo = false;
  readonly requiredEnv = [] as const;

  /** DNS is injectable so tests never touch the network. */
  constructor(
    private resolveMx: (domain: string) => Promise<dns.MxRecord[]> = (domain) => new dns.promises.Resolver({ timeout: DNS_TIMEOUT_MS, tries: 1 }).resolveMx(domain),
    private lookup: (domain: string) => Promise<unknown> = (domain) => dns.promises.lookup(domain),
  ) {}

  isConfigured() {
    return true;
  }

  async verify(emailIn: string): Promise<VerificationResult> {
    const email = (emailIn || "").trim();
    const result = verificationResult({ status: UNKNOWN, provider: this.name });

    if (!SYNTAX_RE.test(email)) {
      return { ...result, syntax_check: "failed", status: INVALID, error: "Email does not match a valid address format." };
    }
    result.syntax_check = "passed";

    const at = email.indexOf("@");
    const local = email.slice(0, at);
    const domain = email.slice(at + 1);
    const labels = domain.split(".");
    if (labels.length < 2 || !labels.every((label) => DOMAIN_LABEL_RE.test(label))) {
      return { ...result, domain_check: "failed", status: INVALID, error: "Domain is not a valid, well-formed domain name." };
    }
    result.domain_check = "passed";

    result.role_based_status = GENERIC_LOCALS.has(local.toLowerCase()) ? "role_based" : "not_role_based";
    result.disposable_status = KNOWN_DISPOSABLE_DOMAINS.has(domain.toLowerCase()) ? "disposable" : "not_disposable";

    const mxOk = await this.hasMx(domain, result);
    if (result.disposable_status === "disposable") result.status = DISPOSABLE;
    else if (!mxOk) {
      result.status = INVALID;
      result.error = result.error || "Domain has no mail server (MX record).";
    } else if (result.role_based_status === "role_based") result.status = ROLE_BASED;
    else {
      // Syntax, domain and MX all check out, but mailbox existence genuinely cannot be
      // confirmed without a dedicated SMTP/catch-all-probing provider — never guess "Valid".
      result.status = UNKNOWN;
      result.error =
        "Syntax, domain and mail server all check out, but mailbox existence was not verified — configure a dedicated verification provider (e.g. ZeroBounce or Hunter) for a definitive result.";
    }
    return result;
  }

  private async hasMx(domain: string, result: VerificationResult): Promise<boolean> {
    try {
      const answer = await this.resolveMx(domain);
      result.mx_check = answer.length ? "passed" : "failed";
      return answer.length > 0;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === dns.NOTFOUND) {
        result.mx_check = "failed";
        result.error = "Domain does not exist (NXDOMAIN).";
        return false;
      }
      if (code === dns.NODATA) {
        // some domains accept mail via an A/AAAA record with no explicit MX (implicit MX)
        try {
          await this.lookup(domain);
          result.mx_check = "passed";
          return true;
        } catch {
          result.mx_check = "failed";
          return false;
        }
      }
      result.mx_check = NOT_AVAILABLE;
      result.error = `MX lookup failed: ${(e as Error).message}`;
      return true; // a lookup failure is not evidence the domain is bad
    }
  }
}

// ================================================================================ Demo/Mock
const DEMO_PEOPLE: [string, string][] = [["Jordan", "Avery"], ["Morgan", "Ellis"], ["Taylor", "Brooks"], ["Casey", "Morgan"], ["Riley", "Hayes"], ["Jamie", "Foster"], ["Avery", "Collins"], ["Quinn", "Parker"]];
const DEMO_TITLES = ["Owner", "Founder", "Sales Manager", "Office Manager", "Operations Manager"];
const DEMO_GENERIC_LOCALS = ["info", "contact", "sales", "support"];

const hash = (value: string) => BigInt("0x" + createHash("sha256").update(value.toLowerCase()).digest("hex"));
const mod = (h: bigint, n: number) => Number(h % BigInt(n));
const bareDomain = (value: string) => value.replace(/^https?:\/\/|^www\.|\/.*$/g, "").trim().toLowerCase();

/** Deterministic simulated discovery, clearly labelled, no network calls. */
export class MockEmailDiscoveryProvider implements EmailDiscoveryProvider {
  readonly name: string = "mock";
  readonly label = "Demo/Mock (simulated data)";
  readonly isDemo: boolean = true;
  readonly requiredEnv = [] as const;

  isConfigured() {
    return true;
  }

  async searchDomain(domainIn: string, limit = 25): Promise<EmailMatch[]> {
    const domain = bareDomain(domainIn || "");
    if (!domain) return [];
    const h = hash(domain);
    const [first, last] = DEMO_PEOPLE[mod(h, DEMO_PEOPLE.length)];
    const matches = [
      emailMatch({ email: `${DEMO_GENERIC_LOCALS[mod(h, DEMO_GENERIC_LOCALS.length)]}@${domain}`, emailType: GENERIC, providerConfidence: 70.0, sourceUrl: `https://${domain}/contact`, sourceTitle: `[DEMO] Contact — ${domain}` }),
      emailMatch({
        email: `${first.toLowerCase()}.${last.toLowerCase()}@${domain}`,
        firstName: first,
        lastName: last,
        fullName: `${first} ${last}`,
        title: DEMO_TITLES[mod(h, DEMO_TITLES.length)],
        emailType: PERSONAL,
        providerConfidence: 88.0,
        sourceUrl: `https://${domain}/about`,
        sourceTitle: `[DEMO] About — ${domain}`,
      }),
    ];
    return matches.slice(0, Math.max(1, limit));
  }

  async findByName(firstName: string, lastName: string, domainIn?: string | null, companyName?: string | null): Promise<EmailMatch[]> {
    let domain = bareDomain(domainIn || companyName || "");
    if (!(firstName && lastName && domain)) return [];
    const h = hash(`${firstName}${lastName}${domain}`);
    if (mod(h, 10) === 0) return []; // occasionally simulate "not found", like the real world
    domain = domain.replaceAll(" ", "").replace(/[^a-z0-9.\-]/g, "") || "example.com";
    if (!domain.includes(".")) domain += ".example";
    return [
      emailMatch({
        email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@${domain}`,
        firstName,
        lastName,
        fullName: `${firstName} ${lastName}`,
        emailType: PERSONAL,
        providerConfidence: 75.0 + mod(h, 20),
        sourceUrl: `https://${domain}/team`,
        sourceTitle: `[DEMO] Team — ${domain}`,
      }),
    ];
  }

  findByCompany(_companyName: string, domain?: string | null) {
    return findByCompanyViaDomain(this, domain);
  }
}

/** Deterministic simulated verification (demos and tests only). */
export class MockEmailVerificationProvider implements EmailVerificationProvider {
  readonly name = "mock";
  readonly label = "Demo/Mock (simulated data)";
  readonly isDemo = true;
  readonly requiredEnv = [] as const;

  isConfigured() {
    return true;
  }

  async verify(email: string): Promise<VerificationResult> {
    const cycle = [VALID, INVALID, RISKY, UNKNOWN, CATCH_ALL, DISPOSABLE, ROLE_BASED];
    const status = cycle[mod(hash(email || ""), cycle.length)];
    const passed = status !== INVALID;
    return verificationResult({
      status,
      syntax_check: "passed",
      domain_check: passed ? "passed" : "failed",
      mx_check: passed ? "passed" : "failed",
      mailbox_check: status === VALID ? "passed" : status === INVALID ? "failed" : NOT_AVAILABLE,
      disposable_status: status === DISPOSABLE ? "disposable" : "not_disposable",
      role_based_status: status === ROLE_BASED ? "role_based" : "not_role_based",
      catch_all_status: status === CATCH_ALL ? "catch_all" : "not_catch_all",
      provider: this.name,
      raw: { demo: true, note: "simulated result" },
    });
  }
}
