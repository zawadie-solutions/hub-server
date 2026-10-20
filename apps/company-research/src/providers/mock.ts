/**
 * Demo/Mock provider: a tiny simulated web so the whole workflow runs without API keys.
 *
 * Everything it returns is SIMULATED. Titles are prefixed with "[DEMO]", domains use the reserved
 * ".example" TLD and phone numbers use the fictional 555-01xx range. No network is touched.
 */
import { createHash } from "node:crypto";
import { cleanText, normalizeCompanyName, stateForms, titleCase, US_STATES } from "../utils/normalization";
import { type SearchProvider, type SearchResult, searchResult } from "./base";

const PEOPLE = ["Jordan Avery", "Morgan Ellis", "Taylor Brooks", "Casey Morgan", "Riley Hayes", "Jamie Foster", "Avery Collins", "Quinn Parker", "Dana Whitfield", "Robin Castillo", "Sam Okafor", "Alex Lindqvist", "Priya Nair", "Diego Marquez", "Hannah Sorensen"];
const CITIES: [string, string][] = [["Springfield", "Illinois"], ["Riverton", "Utah"], ["Fairview", "Texas"], ["Madison", "Wisconsin"], ["Georgetown", "Kentucky"]];
const QUERY_KEYWORDS = new Set(["website", "contact", "phone", "telephone", "owner", "founder", "ceo", "president", "managing", "director", "email", "team", "about", "general", "manager", "operations", "sales", "business", "development", "number", "phone number", "@", "address"]);

export interface MockPerson {
  name: string;
  title: string;
  phone?: string;
  email?: string;
}

export interface MockProfile {
  name: string;
  city?: string;
  state?: string;
  exists?: boolean;
  domain?: string;
  phone?: string;
  street?: string;
  email?: string;
  owner?: MockPerson | null;
  decision_maker?: MockPerson | null;
  conflict_owner?: MockPerson | null;
}

type FullProfile = Required<MockProfile> & { docs: { url: string; title: string; snippet: string }[] };

export const BUILTIN_PROFILES: MockProfile[] = [
  {
    name: "ABC Roofing",
    city: "Portland",
    state: "Oregon",
    owner: { name: "John Smith", title: "Founder", phone: "(555) 555-0143", email: "john@abc-roofing.example" },
    phone: "(555) 555-0142",
    email: "info@abc-roofing.example",
  },
];

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const hash = (name: string) => BigInt("0x" + createHash("sha256").update(normalizeCompanyName(name)).digest("hex"));
const mod = (h: bigint, n: number) => Number(h % BigInt(n));
const pad2 = (n: number) => String(n).padStart(2, "0");

export class MockProvider implements SearchProvider {
  readonly name = "mock";
  readonly label = "Demo/Mock (simulated data)";
  readonly isDemo = true;
  readonly requiredEnv = [] as const;
  private profiles = new Map<string, FullProfile>();

  constructor(
    profiles: MockProfile[] = BUILTIN_PROFILES,
    private autoGenerate = true,
  ) {
    for (const profile of profiles) this.addProfile(profile);
  }

  isConfigured(): boolean {
    return true;
  }

  // ------------------------------------------------------------------ profiles
  addProfile(profile: MockProfile): FullProfile {
    const domain = profile.domain ?? `${slug(profile.name)}.example`;
    const p = {
      exists: true,
      city: "",
      state: "",
      phone: "(555) 555-0100",
      street: `${100 + mod(hash(profile.name), 900)} Main Street`,
      email: `info@${domain}`,
      owner: null,
      decision_maker: null,
      conflict_owner: null,
      ...profile,
      domain,
    } as FullProfile;
    p.docs = MockProvider.buildDocs(p);
    this.profiles.set(normalizeCompanyName(p.name), p);
    return p;
  }

  private generate(name: string, cityIn: string, stateIn: string): MockProfile {
    const h = hash(name);
    let [city, state] = [cityIn, stateIn];
    if (!city && !state) [city, state] = CITIES[mod(h, CITIES.length)];
    const domain = `${slug(name)}.example`;
    const person = PEOPLE[mod(h >> 8n, PEOPLE.length)];
    const other = PEOPLE[mod((h >> 8n) + 5n, PEOPLE.length)];
    const first = person.split(" ")[0].toLowerCase();
    const last2 = mod(h >> 16n, 90) + 10;
    const profile: MockProfile = { name, city, state, domain, phone: `(555) 555-01${pad2(last2)}`, email: `info@${domain}` };
    const owner: MockPerson = { name: person, title: mod(h, 2) ? "Owner" : "Founder", phone: `(555) 555-01${pad2((last2 + 7) % 100)}`, email: `${first}@${domain}` };
    const scenario = mod(h, 20);
    if (scenario === 0) profile.exists = false;
    else if (scenario === 1 || scenario === 2) {
      profile.owner = owner;
      profile.conflict_owner = { name: other, title: "Owner" };
    } else if (scenario >= 3 && scenario <= 5) profile.decision_maker = { ...owner, title: "General Manager" };
    else if (scenario === 6 || scenario === 7) {
      // company only: generic email + phone, no people
    } else if (scenario === 8) profile.owner = { name: person, title: owner.title };
    else profile.owner = owner;
    return profile;
  }

  // ---------------------------------------------------------------------- docs
  private static buildDocs(p: FullProfile) {
    if (!p.exists) return [];
    const { name, city, state, domain } = p;
    const [, abbr] = stateForms(state);
    const where = [city, state].filter(Boolean).join(", ") || "the local area";
    const shortWhere = [city, abbr || state].filter(Boolean).join(", ");
    const s = slug(name);
    const { owner, decision_maker: dm, conflict_owner: rival } = p;
    const docs: { url: string; title: string; snippet: string }[] = [];
    const add = (url: string, title: string, snippet: string) => docs.push({ url, title: `[DEMO] ${title}`, snippet: cleanText(snippet) });

    add(`https://${domain}/`, `${name} | ${where}`, `${name} is a locally operated business serving ${where}. Call ${p.phone} or email ${p.email} for a free estimate.`);

    let about: string;
    if (owner) about = `${owner.name}, ${owner.title} of ${name}, started the company in ${where}.`;
    else if (dm) about = `Day-to-day operations at ${name} are led by ${dm.name}, ${dm.title}.`;
    else about = `${name} has been serving customers in ${where} since 2005.`;
    add(`https://${domain}/about`, `About Us - ${name}`, about);

    let contact = `Main office: ${p.phone} · ${p.email}.`;
    for (const person of [owner, dm]) {
      if (person && (person.phone || person.email)) {
        const direct = [person.phone, person.email].filter(Boolean).join(", ");
        contact += ` ${person.name} (${person.title}) direct line: ${direct}.`;
      }
    }
    add(`https://${domain}/contact`, `Contact - ${name}`, contact);

    if (dm) add(`https://${domain}/team`, `Our Team - ${name}`, `Meet the team at ${name}. ${dm.name} - ${dm.title}. Serving ${where}.`);

    let registry = `${name} LLC. Status: Active. Principal office: ${p.street}`;
    registry += shortWhere ? `, ${shortWhere}.` : ".";
    if (owner) registry += ` Owner: ${owner.name}.`;
    add(`https://registry.demo-gov.example/entity/${s}`, `${name} LLC - Business Entity Record`, registry);

    let listing = `${name} in ${where}. Phone: ${p.phone}.`;
    if (rival) listing += ` Owner: ${rival.name}.`;
    add(`https://demo-directory.example/biz/${s}`, `${name} - ${shortWhere || where} | Demo Business Directory`, listing);

    if (owner) add(`https://demo-news.example/local/${s}-spotlight`, `Local business spotlight: ${name}`, `"We put customers first," said ${owner.name}, owner of ${name} in ${where}.`);

    // A similarly named business somewhere else — the engine must not pick this one.
    const elsewhere: [string, string] = stateForms(state)[0] !== "texas" ? ["Houston", "Texas"] : ["Miami", "Florida"];
    add(
      `https://${s}-supplies-${US_STATES[elsewhere[1].toLowerCase()].toLowerCase()}.example/`,
      `${name} Supplies of ${elsewhere[1]}`,
      `${name} Supplies, ${elsewhere[0]}, ${elsewhere[1]}. Owner: Pat Wrongman. Call (555) 555-0199.`,
    );
    return docs;
  }

  // -------------------------------------------------------------------- search
  async search(query: string, numResults = 10): Promise<SearchResult[]> {
    const quoted = [...query.matchAll(/"([^"]+)"/g)].map((m) => m[1].trim());
    const site = /\bsite:(\S+)/.exec(query);
    const rest = query.replace(/"[^"]*"|\bsite:\S+/g, " ");
    const looseTerms = rest.split(/\s+/).filter(Boolean).map((t) => t.toLowerCase());

    this.ensureProfile(quoted, looseTerms, Boolean(site));

    const profiles = [...this.profiles.values()];
    const knownNames = new Set(profiles.map((p) => p.name.toLowerCase()));
    for (const p of profiles) for (const key of ["owner", "decision_maker", "conflict_owner"] as const) if (p[key]) knownNames.add(p[key]!.name.toLowerCase());

    const required = quoted.map((q) => q.toLowerCase()).filter((q) => knownNames.has(q));
    const scoring = [...looseTerms, ...quoted.map((q) => q.toLowerCase()).filter((q) => !knownNames.has(q))];

    const ranked: [number, number, { url: string; title: string; snippet: string }][] = [];
    let order = 0;
    for (const p of profiles) {
      for (const doc of p.docs) {
        order++;
        const text = `${doc.title} ${doc.snippet} ${doc.url}`.toLowerCase();
        if (site && !doc.url.toLowerCase().includes(site[1].toLowerCase())) continue;
        if (required.some((phrase) => !text.includes(phrase))) continue;
        if (!required.length && !site) continue;
        const score = scoring.filter((term) => text.includes(term)).length;
        ranked.push([-score, order, doc]);
      }
    }
    ranked.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    return ranked.slice(0, numResults).map(([, , d]) =>
      searchResult({ title: d.title, url: d.url, snippet: d.snippet, source: this.name, displayUrl: d.url.replace(/^https?:\/\//, "").replace(/\/+$/, "") }),
    );
  }

  /** Invent a deterministic demo profile the first time a company is searched. */
  private ensureProfile(quoted: string[], looseTerms: string[], hasSite: boolean): void {
    if (!this.autoGenerate || hasSite) return;
    const people = new Set<string>();
    for (const p of this.profiles.values()) for (const k of ["owner", "decision_maker", "conflict_owner"] as const) if (p[k]) people.add(p[k]!.name.toLowerCase());
    for (const phrase of quoted) {
      if (QUERY_KEYWORDS.has(phrase.toLowerCase()) || people.has(phrase.toLowerCase())) continue;
      if (this.profiles.has(normalizeCompanyName(phrase))) return;
      const location = looseTerms.filter((t) => !QUERY_KEYWORDS.has(t));
      const [city, state] = MockProvider.splitLocation(location);
      this.addProfile(this.generate(phrase, city, state));
      return;
    }
  }

  private static splitLocation(words: string[]): [string, string] {
    const text = words.join(" ");
    for (const state of Object.keys(US_STATES).sort((a, b) => b.length - a.length)) {
      if (text.endsWith(state)) return [titleCase(text.slice(0, -state.length).trim()), titleCase(state)];
    }
    return [titleCase(text), ""];
  }
}
