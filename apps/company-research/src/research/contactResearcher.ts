/**
 * Phone, email and address research.
 *
 * Only publicly listed business contact details that literally appear in a source are used.
 * Nothing is guessed: no pattern-built emails, no generated phone numbers. People-search sites
 * and contact-data brokers are excluded (see verification.BLOCKED_DOMAINS).
 */
import type { Settings } from "../config";
import { escapeRegExp, personKey, phoneDigits, pyRound } from "../utils/normalization";
import { type Doc, LISTING_TYPES, usable } from "./companyResearcher";
import { Candidate, combine, type EvidenceItem } from "./confidence";
import { excerpt, extractAddresses, extractEmails, extractPhones, FREEMAIL_DOMAINS, GENERIC_LOCALS, splitEmail } from "./extraction";
import { sourceScore, statusFor } from "./verification";

const PHONE_WINDOW = 100; // a person's phone must follow their name within this many characters
const EMAIL_WINDOW = 120;
const CONTACT_MIN_RELEVANCE = 0.75;
const BUSINESS_SOURCES = new Set([...LISTING_TYPES, "official_website"]);

type Groups = Map<string, EvidenceItem[]>;

function add(groups: Groups, key: string, item: EvidenceItem) {
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key)!.push(item);
}

function best(groups: Groups, settings: Settings, display?: Map<string, string>): Candidate | null {
  const candidates: Candidate[] = [];
  for (const [key, evidence] of groups) {
    const confidence = combine(evidence);
    candidates.push(new Candidate({ value: display?.get(key) ?? key, evidence, confidence, status: statusFor(confidence, settings.thresholds) }));
  }
  candidates.sort((a, b) => b.confidence - a.confidence || b.evidence.length - a.evidence.length);
  if (candidates.length && candidates[0].confidence >= settings.thresholds.likely) return candidates[0];
  return null;
}

const item = (doc: Doc, value: string, pos: number, score: number): EvidenceItem => ({
  value,
  sourceType: doc.sourceType,
  sourceUrl: doc.url,
  sourceTitle: doc.title,
  score: pyRound(score, 1),
  snippet: excerpt(doc.text, pos, pos + value.length),
  detail: "",
});

const contactDocs = (docs: Doc[]) => docs.filter((d) => usable(d) && (d.official || d.relevance >= CONTACT_MIN_RELEVANCE));

function namePattern(personName: string): RegExp | null {
  const parts = personKey(personName).split(" ");
  if (parts.length < 2) return null;
  const first = escapeRegExp(parts[0]);
  const last = escapeRegExp(parts[parts.length - 1]);
  return new RegExp(`\\b${first}\\b(?:\\s+[A-Z]\\.?)?(?:\\s+[\\w'’-]+)?\\s+${last}\\b`, "gi");
}

const onDomain = (domain: string, companyDomain: string | null | undefined) => Boolean(companyDomain) && (domain === companyDomain || domain.endsWith("." + companyDomain));

// ------------------------------------------------------------ company level
export function findBusinessPhone(docs: Doc[], settings: Settings): Candidate | null {
  const groups: Groups = new Map();
  const display = new Map<string, string>();
  for (const doc of contactDocs(docs)) {
    if (!BUSINESS_SOURCES.has(doc.sourceType)) continue;
    const base = sourceScore(doc.sourceType, settings.source_scores) * doc.relevance;
    for (const [shown, digits, pos] of extractPhones(doc.text)) {
      if (!display.has(digits)) display.set(digits, shown);
      add(groups, digits, item(doc, shown, pos, base));
    }
  }
  return best(groups, settings, display);
}

export function findAddress(docs: Doc[], settings: Settings): Candidate | null {
  const groups: Groups = new Map();
  for (const doc of contactDocs(docs)) {
    if (!BUSINESS_SOURCES.has(doc.sourceType)) continue;
    const base = sourceScore(doc.sourceType, settings.source_scores) * doc.relevance;
    for (const address of extractAddresses(doc.text)) add(groups, address, item(doc, address, doc.text.indexOf(address), base));
  }
  return best(groups, settings);
}

export function findCompanyEmail(docs: Doc[], settings: Settings, companyDomain: string | null | undefined, exclude: (string | null | undefined)[] = []): Candidate | null {
  const groups: Groups = new Map();
  const excluded = new Set(exclude.filter(Boolean).map((e) => e!.toLowerCase()));
  for (const doc of contactDocs(docs)) {
    const base = sourceScore(doc.sourceType, settings.source_scores) * doc.relevance;
    for (const [email, pos] of extractEmails(doc.text)) {
      if (excluded.has(email)) continue;
      const [local, domain] = splitEmail(email);
      const generic = GENERIC_LOCALS.has(local);
      const onCompanyDomain = onDomain(domain, companyDomain);
      if (FREEMAIL_DOMAINS.has(domain)) {
        // a free-mail address only counts when the business itself publishes it
        if (!(doc.official || (LISTING_TYPES.has(doc.sourceType) && doc.relevance >= 0.9))) continue;
      } else if (!(onCompanyDomain || doc.official || (generic && LISTING_TYPES.has(doc.sourceType)))) {
        continue;
      }
      // a personal-looking mailbox may belong to an individual, so it scores lower
      const factor = generic ? 1.0 : 0.85;
      add(groups, email, item(doc, email, pos, base * factor));
    }
  }
  return best(groups, settings);
}

// ------------------------------------------------------------- person level
/** A phone listed directly after the person's name that is not the main company line. */
export function findPersonPhone(docs: Doc[], personName: string, settings: Settings, businessPhone?: string | null): Candidate | null {
  const pattern = namePattern(personName);
  if (!pattern) return null;
  const mainLine = phoneDigits(businessPhone);
  const groups: Groups = new Map();
  const display = new Map<string, string>();
  for (const doc of contactDocs(docs)) {
    const phones = extractPhones(doc.text);
    if (!phones.length) continue;
    const base = sourceScore(doc.sourceType, settings.source_scores) * doc.relevance;
    for (const nameMatch of doc.text.matchAll(pattern)) {
      const nameEnd = nameMatch.index! + nameMatch[0].length;
      const following = phones.filter((p) => p[2] - nameEnd >= 0 && p[2] - nameEnd <= PHONE_WINDOW);
      if (!following.length) continue;
      const [shown, digits, pos] = following[0];
      if (digits === mainLine) continue;
      if (!display.has(digits)) display.set(digits, shown);
      add(groups, digits, item(doc, shown, pos, base));
    }
  }
  return best(groups, settings, display);
}

function localMatchesPerson(local: string, personName: string): boolean {
  const parts = personKey(personName).split(" ");
  if (parts.length < 2) return false;
  const first = parts[0].replace(/[^a-z]/g, "");
  const last = parts[parts.length - 1].replace(/[^a-z]/g, "");
  if (!first || !last) return false;
  const forms = new Set([first, last, first + last, `${first}.${last}`, `${first}_${last}`, `${first}-${last}`, first[0] + last, `${first[0]}.${last}`, first + last[0], last + first[0], `${last}.${first}`]);
  return forms.has(local.toLowerCase());
}

/** An email that was actually published and is tied to the person by name or position. */
export function findPersonEmail(docs: Doc[], personName: string, settings: Settings, companyDomain: string | null | undefined): Candidate | null {
  const pattern = namePattern(personName);
  if (!pattern) return null;
  const groups: Groups = new Map();
  for (const doc of contactDocs(docs)) {
    const emails = extractEmails(doc.text);
    if (!emails.length) continue;
    const base = sourceScore(doc.sourceType, settings.source_scores) * doc.relevance;
    const nameEnds = [...doc.text.matchAll(pattern)].map((m) => m.index! + m[0].length);
    if (!nameEnds.length && !doc.official) continue;
    for (const [email, pos] of emails) {
      const [local, domain] = splitEmail(email);
      if (GENERIC_LOCALS.has(local)) continue;
      const onCompanyDomain = onDomain(domain, companyDomain);
      const publishedByBusiness = doc.official || LISTING_TYPES.has(doc.sourceType);
      if (FREEMAIL_DOMAINS.has(domain) && !publishedByBusiness) continue;
      const named = localMatchesPerson(local, personName);
      const adjacent =
        nameEnds.some((end) => pos - end >= 0 && pos - end <= EMAIL_WINDOW) &&
        !nameEnds.some((end) => emails.some(([, otherPos]) => otherPos !== pos && otherPos - end >= 0 && otherPos - end < pos - end));
      let factor: number;
      if (named && (onCompanyDomain || nameEnds.length)) factor = 1.0;
      else if (adjacent && (onCompanyDomain || publishedByBusiness)) factor = 0.9;
      else continue;
      add(groups, email, item(doc, email, pos, base * factor));
    }
  }
  return best(groups, settings);
}
