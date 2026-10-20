/**
 * Picks which email discovery/verification provider is actually used, and the web-search-backed
 * discovery fallback.
 *
 * Discovery priority:    Hunter.io (if configured) > the existing live SearchProvider > Demo/Mock.
 * Verification priority: a dedicated provider (ZeroBounce, then Hunter) > the built-in free
 *                        verifier (always available, real, no key). Mock is never auto-selected.
 */
import { envSet, type Settings } from "../config";
import { type CompanyLike, prepareDocs, usable } from "../research/companyResearcher";
import { findPersonEmail } from "../research/contactResearcher";
import { extractEmails, extractPeople, GENERIC_LOCALS, splitEmail } from "../research/extraction";
import { sourceScore } from "../research/verification";
import { minBy, pyRound } from "../utils/normalization";
import { AllProvidersFailed, type SearchProvider, type SearchResult } from "./base";
import { type EmailDiscoveryProvider, type EmailMatch, emailMatch, type EmailVerificationProvider, findByCompanyViaDomain, GENERIC, PERSONAL } from "./emailBase";
import { BuiltinEmailVerifier, HunterProvider, MockEmailDiscoveryProvider, MockEmailVerificationProvider, ZeroBounceProvider } from "./emailProviders";

const DOC_MIN_RELEVANCE = 0.75;
const PERSON_PROXIMITY = 200; // characters: how close a name must be to an email to associate them

const blankCompany = (name: string): CompanyLike => ({ company_name: name, city: null, state: null });
const usableDocs = (docs: ReturnType<typeof prepareDocs>) => docs.filter((d) => usable(d) && (d.official || d.relevance >= DOC_MIN_RELEVANCE));

/**
 * Email discovery backed by the existing SearchProvider chain — no Hunter.io key required. Reuses
 * the company-research building blocks (prepareDocs, extraction, source scoring, confidence):
 * genuinely live results, just sourced from ordinary search results rather than an email API.
 */
export class WebSearchEmailDiscoveryProvider implements EmailDiscoveryProvider {
  readonly name = "web_search";
  readonly label = "Web Search (existing SearchProvider)";
  readonly isDemo = false;
  readonly requiredEnv = [] as const;

  constructor(
    private searchProvider: SearchProvider,
    private settings: Settings,
  ) {}

  isConfigured() {
    return true;
  }

  private async runQueries(queries: string[]): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    for (const query of queries) {
      try {
        for (const item of await this.searchProvider.search(query, this.settings.max_results_per_query)) results.push({ ...item, query });
      } catch (e) {
        if (!(e instanceof AllProvidersFailed)) throw e;
      }
    }
    return results;
  }

  async searchDomain(domain: string, limit = 25): Promise<EmailMatch[]> {
    const queries = [`site:${domain} email`, `site:${domain} contact`, `site:${domain} team`, `"${domain}" email`];
    const docs = usableDocs(prepareDocs(await this.runQueries(queries), blankCompany(domain), domain));
    const matches = new Map<string, EmailMatch>();
    const scores = new Map<string, number>();
    for (const doc of docs) {
      const base = sourceScore(doc.sourceType, this.settings.source_scores) * doc.relevance;
      const people = extractPeople(doc.text);
      for (const [email, pos] of extractEmails(doc.text)) {
        const [local, emailDomain] = splitEmail(email);
        if (emailDomain !== domain && !emailDomain.endsWith("." + domain)) continue;
        if (base <= (scores.get(email) ?? -1)) continue;
        scores.set(email, base);
        const nearest = minBy(people, (p) => Math.abs(p.start - pos));
        const associated = nearest && Math.abs(nearest.start - pos) <= PERSON_PROXIMITY ? nearest : null;
        let first = "";
        let last = "";
        if (associated) {
          const parts = associated.name.split(/\s+/);
          first = parts[0];
          last = parts.length > 1 ? parts[parts.length - 1] : "";
        }
        matches.set(
          email,
          emailMatch({
            email,
            firstName: first,
            lastName: last,
            fullName: associated ? associated.name : "",
            title: associated ? associated.title : "",
            emailType: GENERIC_LOCALS.has(local) ? GENERIC : PERSONAL,
            providerConfidence: pyRound(Math.min(99.0, base), 1),
            sourceUrl: doc.url,
            sourceTitle: doc.title,
          }),
        );
      }
    }
    return [...matches.values()].slice(0, limit);
  }

  async findByName(firstName: string, lastName: string, domain?: string | null, companyName?: string | null): Promise<EmailMatch[]> {
    const person = `${firstName} ${lastName}`.trim();
    if (!person) return [];
    const companyLabel = companyName || domain || "";
    let queries: string[] = [];
    if (companyLabel) queries.push(`"${person}" "${companyLabel}" email`, `"${person}" "${companyLabel}" contact`);
    if (domain) queries.push(`"${person}" site:${domain}`);
    if (!queries.length) queries = [`"${person}" email`];
    const docs = usableDocs(prepareDocs(await this.runQueries(queries), blankCompany(companyLabel || person), domain));
    const candidate = findPersonEmail(docs, person, this.settings, domain);
    if (!candidate) return [];
    const best = candidate.best;
    return [
      emailMatch({
        email: candidate.value,
        firstName,
        lastName,
        fullName: person,
        emailType: GENERIC_LOCALS.has(candidate.value.split("@")[0]) ? GENERIC : PERSONAL,
        providerConfidence: candidate.confidence,
        sourceUrl: best ? best.sourceUrl : "",
        sourceTitle: best ? best.sourceTitle : "",
      }),
    ];
  }

  findByCompany(_companyName: string, domain?: string | null) {
    return findByCompanyViaDomain(this, domain);
  }
}

// ----------------------------------------------------------------------------- selection
export const DISCOVERY_CLASSES: Record<string, () => EmailDiscoveryProvider> = {
  hunter: () => new HunterProvider(),
  mock: () => new MockEmailDiscoveryProvider(),
};
export const VERIFICATION_CLASSES: Record<string, () => EmailVerificationProvider> = {
  zerobounce: () => new ZeroBounceProvider(),
  hunter: () => new HunterProvider(),
  builtin: () => new BuiltinEmailVerifier(),
  mock: () => new MockEmailVerificationProvider(),
};

const hunter = new HunterProvider();
const builtin = new BuiltinEmailVerifier();
const mockDiscovery = new MockEmailDiscoveryProvider();

/** [provider, isDemo]. `searchProvider` is the company-research search chain, reused as the live fallback. */
export function buildDiscoveryProvider(settings: Settings, searchProvider?: SearchProvider | null): [EmailDiscoveryProvider, boolean] {
  if (hunter.isConfigured()) return [hunter, false];
  if (searchProvider && !searchProvider.isDemo) return [new WebSearchEmailDiscoveryProvider(searchProvider, settings), false];
  return [mockDiscovery, true];
}

export function buildVerificationProvider(): [EmailVerificationProvider, boolean] {
  for (const name of ["zerobounce", "hunter"]) {
    const provider = VERIFICATION_CLASSES[name]();
    if (provider.isConfigured()) return [provider, false];
  }
  return [builtin, false]; // the built-in verifier is real, not demo data
}

const statusRow = (name: string, provider: { label: string; isDemo: boolean; requiredEnv: readonly string[]; isConfigured(): boolean }) => ({
  name,
  label: provider.label,
  is_demo: provider.isDemo,
  configured: provider.isConfigured(),
  required_env: [...provider.requiredEnv],
  env_set: Object.fromEntries(provider.requiredEnv.map((key) => [key, envSet(key)])),
});

export function discoveryProviderStatus() {
  return [
    ...Object.entries(DISCOVERY_CLASSES).map(([name, make]) => statusRow(name, make())),
    { name: "web_search", label: "Web Search (fallback, no extra key needed)", is_demo: false, configured: true, required_env: [], env_set: {} },
  ];
}

export const verificationProviderStatus = () => Object.entries(VERIFICATION_CLASSES).map(([name, make]) => statusRow(name, make()));

/** Every API-key name the Settings page may write. */
export function allowedKeyNames(searchProviders: { requiredEnv: readonly string[] }[]): Set<string> {
  const names = new Set<string>(["BING_ENDPOINT"]);
  for (const p of [...searchProviders, ...Object.values(DISCOVERY_CLASSES).map((m) => m()), ...Object.values(VERIFICATION_CLASSES).map((m) => m())]) for (const key of p.requiredEnv) names.add(key);
  return names;
}
