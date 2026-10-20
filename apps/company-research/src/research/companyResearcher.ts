/**
 * Company identification: decide which search results are really about this company.
 *
 * A name match alone is never enough — the domain, the location and how often a site shows up
 * across different queries all count, and a similarly named business elsewhere is rejected.
 */
import type { Settings } from "../config";
import { NOT_FOUND, UNCERTAIN } from "../models";
import type { SearchResult } from "../providers/base";
import { cleanText, compactName, domainLabel, escapeRegExp, minBy, nameTokens, normalizeCompanyName, normalizeText, pyRound, registeredDomain, stateForms, US_STATES } from "../utils/normalization";
import { Candidate, combine, type EvidenceItem, evidenceItem, MAX_CONFIDENCE } from "./confidence";
import { BLOCK_SEP } from "./extraction";
import { BLOCKED, classifySource, couldBeOfficial, sourceScore, statusFor } from "./verification";

export const LISTING_TYPES = new Set(["government_registry", "official_business_profile", "reputable_directory"]);
const MIN_RELEVANCE = 0.5; // below this a page is treated as being about some other business
const AMBIGUITY_MARGIN = 8; // two candidate websites this close together need a human

export interface CompanyLike {
  company_name: string;
  city?: string | null;
  state?: string | null;
  address?: string | null;
}

/** A search result (or fetched official page) prepared for analysis. */
export interface Doc {
  title: string;
  url: string;
  snippet: string;
  provider: string;
  query: string;
  text: string;
  domain: string;
  sourceType: string;
  relevance: number;
  official: boolean;
}

export interface Identification {
  identified: boolean;
  confidence: number;
  status: string;
  website: string | null;
  domain: string | null;
  ambiguous: boolean;
  evidence: EvidenceItem | null;
  candidates: Candidate[];
}

export const emptyIdentification = (candidates: Candidate[] = []): Identification => ({
  identified: false,
  confidence: 0,
  status: NOT_FOUND,
  website: null,
  domain: null,
  ambiguous: false,
  evidence: null,
  candidates,
});

export function nameMatch(text: string, companyName: string): number {
  const haystack = ` ${normalizeText(text)} `;
  const phrase = normalizeCompanyName(companyName);
  if (!phrase) return 0.0;
  if (haystack.includes(` ${phrase} `)) return 1.0;
  if (phrase.split(" ").every((token) => haystack.includes(` ${token} `))) return 0.8;
  return 0.0;
}

/** 1.0 when the page confirms the location, 0.3 when it clearly names a different state. */
export function locationFactor(text: string, cityIn: string | null | undefined, stateIn: string | null | undefined): number {
  const city = cleanText(cityIn);
  const state = cleanText(stateIn);
  if (!city && !state) return 0.9;
  const lower = ` ${normalizeText(text)} `;
  const [full, abbr] = stateForms(state);
  const hasCity = Boolean(city) && lower.includes(` ${normalizeText(city)} `);
  let hasState = Boolean(full) && lower.includes(` ${full} `);
  if (abbr && new RegExp(`,\\s*${abbr}\\b|\\b${abbr}\\s+\\d{5}\\b`).test(text)) hasState = true;
  let otherState = false;
  if (full) {
    const cityNorm = normalizeText(city);
    for (const [other, otherAbbr] of Object.entries(US_STATES)) {
      // skip states whose name is part of ours or of the city (e.g. "Washington" in a street name is accepted risk)
      if (other === full || full.includes(other) || other.includes(full)) continue;
      if (lower.includes(` ${other} `) && !cityNorm.includes(other)) otherState = true;
      else if (new RegExp(`,\\s*${otherAbbr}\\b(?!\\.)`).test(text)) otherState = true;
    }
  }
  if (otherState && !hasState) return 0.3;
  if (hasCity && (hasState || !full)) return 1.0;
  if (hasCity || hasState) return 0.92;
  return 0.8;
}

export function domainMatch(domain: string, companyName: string): number {
  const label = domainLabel(domain);
  const compact = compactName(companyName);
  if (!label || !compact) return 0.0;
  if (label === compact) return 1.0;
  if (compact.length >= 5 && label.includes(compact)) return 0.9 * (compact.length / label.length) ** 0.5;
  if (label.length >= 4 && compact.includes(label)) return 0.8;
  const tokens = nameTokens(companyName).filter((t) => t.length >= 3);
  if (!tokens.length) return 0.0;
  return (0.6 * tokens.filter((t) => label.includes(t)).length) / tokens.length;
}

/** Turn raw results into Docs with source type and company relevance. */
export function prepareDocs(results: SearchResult[], company: CompanyLike, officialDomain?: string | null): Doc[] {
  const docs: Doc[] = [];
  const seen = new Set<string>();
  for (const r of results) {
    const key = JSON.stringify([r.url, r.snippet]);
    if (seen.has(key)) continue;
    seen.add(key);
    const text = `${r.title}${BLOCK_SEP}${r.snippet}`;
    const sourceType = classifySource(r.url, officialDomain);
    const official = sourceType === "official_website";
    const relevance = official ? 1.0 : nameMatch(text, company.company_name) * locationFactor(text, company.city, company.state);
    docs.push({ title: r.title, url: r.url, snippet: r.snippet, provider: r.source, query: r.query ?? "", text, domain: registeredDomain(r.url), sourceType, relevance, official });
  }
  return docs;
}

export const usable = (doc: Doc) => doc.sourceType !== BLOCKED && (doc.official || doc.relevance >= MIN_RELEVANCE);

function urlPath(url: string): string {
  try {
    return new URL(url).pathname || "/";
  } catch {
    return "/";
  }
}

function siteRoot(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}/`;
  } catch {
    return url;
  }
}

export function identifyCompany(company: CompanyLike, results: SearchResult[], settings: Settings): Identification {
  const scores = settings.source_scores;
  const thresholds = settings.thresholds;
  const docs = prepareDocs(results, company);

  // ---- candidate official websites, grouped by domain
  const byDomain = new Map<string, Doc[]>();
  for (const doc of docs) {
    if (doc.domain && couldBeOfficial(doc.url)) {
      if (!byDomain.has(doc.domain)) byDomain.set(doc.domain, []);
      byDomain.get(doc.domain)!.push(doc);
    }
  }

  // how often each domain turned up: distinct (query, page) pairs across all searches
  const hits = new Map<string, Set<string>>();
  for (const r of results) {
    const d = registeredDomain(r.url);
    if (!hits.has(d)) hits.set(d, new Set());
    hits.get(d)!.add(JSON.stringify([r.query ?? "", r.url]));
  }

  const siteCandidates: Candidate[] = [];
  for (const [domain, group] of byDomain) {
    const dm = domainMatch(domain, company.company_name);
    const tm = Math.max(...group.map((d) => nameMatch(d.text, company.company_name)));
    if (tm === 0 && dm < 0.5) continue;
    const loc = Math.max(...group.map((d) => locationFactor(d.text, company.city, company.state)));
    const freq = Math.min(1.0, (hits.get(domain)?.size ?? 0) / 3);
    const score = Math.min(MAX_CONFIDENCE, 100 * (0.5 * dm + 0.3 * tm + 0.2 * freq) * loc);
    const home = minBy(group, (d) => urlPath(d.url).length)!;
    const website = siteRoot(home.url);
    const candidate = new Candidate({
      value: website,
      detail: domain,
      confidence: pyRound(score, 1),
      evidence: [evidenceItem({ value: website, sourceType: "official_website", sourceUrl: home.url, sourceTitle: home.title, snippet: home.snippet, score: pyRound(score, 1) })],
    });
    candidate.status = statusFor(candidate.confidence, thresholds);
    siteCandidates.push(candidate);
  }
  siteCandidates.sort((a, b) => b.confidence - a.confidence);

  if (siteCandidates.length && siteCandidates[0].confidence >= thresholds.uncertain) {
    const top = siteCandidates[0];
    const ident: Identification = {
      identified: true,
      confidence: top.confidence,
      status: top.status,
      website: top.value,
      domain: top.detail,
      ambiguous: false,
      evidence: top.evidence[0],
      candidates: siteCandidates.slice(0, 4),
    };
    const runnerUp = siteCandidates[1];
    if (runnerUp && runnerUp.confidence >= thresholds.uncertain && top.confidence - runnerUp.confidence < AMBIGUITY_MARGIN) {
      ident.ambiguous = true;
      ident.status = UNCERTAIN;
    }
    return ident;
  }

  // ---- no website: fall back to registry / business profile / directory listings
  const listingEvidence = docs
    .filter((d) => LISTING_TYPES.has(d.sourceType) && d.relevance >= MIN_RELEVANCE)
    .map((d) => evidenceItem({ value: company.company_name, sourceType: d.sourceType, sourceUrl: d.url, sourceTitle: d.title, snippet: d.snippet, score: pyRound(sourceScore(d.sourceType, scores) * d.relevance, 1) }));
  const confidence = combine(listingEvidence);
  if (confidence >= thresholds.uncertain) {
    const best = listingEvidence.reduce((a, b) => (b.score > a.score ? b : a));
    return { ...emptyIdentification(siteCandidates.slice(0, 4)), identified: true, confidence, status: statusFor(confidence, thresholds), evidence: best };
  }
  return emptyIdentification(siteCandidates.slice(0, 4));
}

/** The company-name pattern used to judge whether a person is mentioned near the company. */
export function companyPattern(companyName: string): RegExp | null {
  const tokens = nameTokens(companyName);
  if (!tokens.length) return null;
  return new RegExp(tokens.map(escapeRegExp).join("[\\W_]+"), "gi");
}
