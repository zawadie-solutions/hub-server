/**
 * Evidence-based confidence.
 *
 * A field's confidence is derived only from its evidence:
 *
 *     confidence = best evidence score x 0.96  +  3 points per additional independent domain
 *                  (max +9), capped at 99
 *
 * where an evidence score = source-hierarchy score x how clearly the page is about this company.
 * The 0.96 factor means a single source is never treated as certain; agreement between
 * independent sources is what pushes a value toward 99. Nothing is ever padded to look complete.
 */
import { maxBy, pyRound, registeredDomain } from "../utils/normalization";

const SINGLE_SOURCE_FACTOR = 0.96;
const CORROBORATION_BONUS = 3;
const MAX_BONUS = 9;
export const MAX_CONFIDENCE = 99;

export interface EvidenceItem {
  value: string;
  sourceType: string;
  sourceUrl: string;
  sourceTitle: string;
  snippet: string;
  score: number;
  detail: string;
}

export const evidenceItem = (e: Omit<EvidenceItem, "detail"> & { detail?: string }): EvidenceItem => ({ detail: "", ...e });

export class Candidate {
  value: string;
  detail: string;
  evidence: EvidenceItem[];
  confidence: number;
  status: string;

  constructor(init: { value: string; detail?: string; evidence?: EvidenceItem[]; confidence?: number; status?: string }) {
    this.value = init.value;
    this.detail = init.detail ?? "";
    this.evidence = init.evidence ?? [];
    this.confidence = init.confidence ?? 0;
    this.status = init.status ?? "";
  }

  get best(): EvidenceItem | undefined {
    return maxBy(this.evidence, (e) => e.score);
  }

  toDict() {
    const best = this.best;
    return {
      value: this.value,
      detail: this.detail,
      confidence: pyRound(this.confidence),
      source_type: best ? best.sourceType : "",
      source_title: best ? best.sourceTitle : "",
      source_url: best ? best.sourceUrl : "",
      snippet: best ? best.snippet : "",
      sources: new Set(this.evidence.map((e) => registeredDomain(e.sourceUrl))).size,
    };
  }
}

export function combine(evidence: EvidenceItem[]): number {
  if (!evidence.length) return 0.0;
  const best = Math.max(...evidence.map((e) => e.score));
  const domains = new Set(evidence.filter((e) => e.score >= 50).map((e) => registeredDomain(e.sourceUrl)));
  const bonus = Math.min(MAX_BONUS, CORROBORATION_BONUS * Math.max(0, domains.size - 1));
  return pyRound(Math.min(MAX_CONFIDENCE, best * SINGLE_SOURCE_FACTOR + bonus), 1);
}

/** Mean confidence of the fields that were actually found. */
export function overallConfidence(values: (number | null | undefined)[]): number | null {
  const found = values.filter((v): v is number => Boolean(v));
  return found.length ? pyRound(found.reduce((a, b) => a + b, 0) / found.length, 1) : null;
}
