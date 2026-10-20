/**
 * Owner and decision-maker research.
 *
 * Someone is only called an OWNER when a source says owner / co-owner / founder / proprietor.
 * CEOs, presidents, managers etc. are decision makers and keep the title that was actually found.
 * Two different owners from credible sources is a CONFLICT for a human — never an automatic pick.
 */
import type { Settings } from "../config";
import { CONFLICT, LIKELY, NOT_FOUND, UNCERTAIN, VERIFIED } from "../models";
import { maxBy, personKey, pyRound } from "../utils/normalization";
import { type CompanyLike, companyPattern, type Doc, usable } from "./companyResearcher";
import { Candidate, combine, type EvidenceItem } from "./confidence";
import { excerpt, extractPeople } from "./extraction";
import { sourceScore, statusFor } from "./verification";

const PROXIMITY_CHARS = 250;
const FAR_FROM_COMPANY_FACTOR = 0.75;

export class Person {
  names = new Map<string, number>();
  ownerEvidence: EvidenceItem[] = [];
  dmEvidence: EvidenceItem[] = [];
  dmRank = 99;

  constructor(readonly key: string) {}

  /** The most often seen spelling (the first one seen wins a tie). */
  get name(): string {
    let best = "";
    let count = -1;
    for (const [name, n] of this.names) {
      if (n > count) {
        best = name;
        count = n;
      }
    }
    return best;
  }
}

export interface OwnerDecision {
  status: string;
  owner: Candidate | null; // set for VERIFIED / LIKELY
  candidates: Candidate[]; // for CONFLICT / UNCERTAIN review
}

export const noOwner = (): OwnerDecision => ({ status: NOT_FOUND, owner: null, candidates: [] });

export function collectPeople(docs: Doc[], company: CompanyLike, settings: Settings): Map<string, Person> {
  const people = new Map<string, Person>();
  const pattern = companyPattern(company.company_name);
  for (const doc of docs) {
    if (!usable(doc)) continue;
    const base = sourceScore(doc.sourceType, settings.source_scores) * doc.relevance;
    const companySpots = pattern ? [...doc.text.matchAll(pattern)].map((m) => m.index!) : [];
    for (const mention of extractPeople(doc.text, company.company_name, [company.city || "", company.state || ""])) {
      const near = doc.official || companySpots.some((pos) => mention.start - PROXIMITY_CHARS <= pos && pos <= mention.end + PROXIMITY_CHARS);
      const score = pyRound(base * (near ? 1.0 : FAR_FROM_COMPANY_FACTOR), 1);
      const item: EvidenceItem = {
        value: mention.name,
        detail: mention.title,
        sourceType: doc.sourceType,
        sourceUrl: doc.url,
        sourceTitle: doc.title,
        score,
        snippet: excerpt(doc.text, mention.start, mention.end),
      };
      const key = personKey(mention.name);
      if (!people.has(key)) people.set(key, new Person(key));
      const person = people.get(key)!;
      person.names.set(mention.name, (person.names.get(mention.name) ?? 0) + 1);
      if (mention.roleClass === "owner") person.ownerEvidence.push(item);
      else {
        person.dmEvidence.push(item);
        person.dmRank = Math.min(person.dmRank, mention.rank);
      }
    }
  }
  return people;
}

function candidateFor(person: Person, evidence: EvidenceItem[], settings: Settings): Candidate {
  const best = maxBy(evidence, (e) => e.score)!;
  const confidence = combine(evidence);
  return new Candidate({ value: person.name, detail: best.detail, evidence: [...evidence], confidence, status: statusFor(confidence, settings.thresholds) });
}

export function decideOwner(people: Map<string, Person>, settings: Settings): OwnerDecision {
  const thresholds = settings.thresholds;
  const candidates = [...people.values()].filter((p) => p.ownerEvidence.length).map((p) => candidateFor(p, p.ownerEvidence, settings));
  candidates.sort((a, b) => b.confidence - a.confidence);
  if (!candidates.length) return noOwner();
  const top = candidates[0];
  const rivals = candidates.slice(1).filter((c) => c.best!.score >= thresholds.conflict_min_score);
  if (rivals.length && top.best!.score >= thresholds.conflict_min_score) return { status: CONFLICT, owner: null, candidates: [top, ...rivals] };
  if (top.status === VERIFIED || top.status === LIKELY) return { status: top.status, owner: top, candidates: candidates.slice(0, 4) };
  if (top.status === UNCERTAIN) return { status: UNCERTAIN, owner: null, candidates: candidates.slice(0, 4) };
  return noOwner();
}

/** Most senior decision maker (by title priority) with at least LIKELY evidence. */
export function decideDecisionMaker(people: Map<string, Person>, settings: Settings, excludeKey?: string | null): Candidate | null {
  const ranked: [number, number, Candidate][] = [];
  for (const person of people.values()) {
    if (!person.dmEvidence.length || person.key === excludeKey) continue;
    const candidate = candidateFor(person, person.dmEvidence, settings);
    if (candidate.status === VERIFIED || candidate.status === LIKELY) ranked.push([person.dmRank, -candidate.confidence, candidate]);
  }
  ranked.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return ranked.length ? ranked[0][2] : null;
}
