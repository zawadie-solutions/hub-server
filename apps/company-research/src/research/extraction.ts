/**
 * Pull people, emails, phone numbers and addresses out of result text.
 *
 * Only values literally present in the text are returned — nothing is guessed or generated.
 */
import { isUpper, nameTokens, phoneDigits, splitWords, stripChars, US_STATES } from "../utils/normalization";

export const BLOCK_SEP = " ¦ "; // separates title / snippet / page blocks so matches cannot straddle them

/**
 * Makes a regex fragment case-insensitive on its own (Python's scoped `(?i:...)`, which older
 * Node versions lack) by turning each letter into a `[xX]` class. Escapes are left alone.
 */
function ci(source: string): string {
  let out = "";
  let inClass = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === "\\") {
      out += ch + source[++i];
    } else if (inClass) {
      out += /[a-z]/i.test(ch) ? ch.toLowerCase() + ch.toUpperCase() : ch;
      if (ch === "]") inClass = false;
    } else if (ch === "[") {
      inClass = true;
      out += ch;
    } else if (/[a-z]/i.test(ch)) {
      out += `[${ch.toLowerCase()}${ch.toUpperCase()}]`;
    } else {
      out += ch;
    }
  }
  return out;
}

// ------------------------------------------------------------------ titles
// [pattern, canonical title, role class, decision-maker priority — lower is more senior]
const TITLE_DEFS: [string, string, "owner" | "decision_maker", number][] = [
  ["co-?owner", "Co-Owner", "owner", 1],
  ["owner\\s*/\\s*operator", "Owner/Operator", "owner", 1],
  ["owner", "Owner", "owner", 1],
  ["co-?founder", "Co-Founder", "owner", 2],
  ["founder", "Founder", "owner", 2],
  ["sole\\s+proprietor", "Sole Proprietor", "owner", 1],
  ["proprietor", "Proprietor", "owner", 1],
  ["chief\\s+executive\\s+officer", "CEO", "decision_maker", 3],
  ["ceo", "CEO", "decision_maker", 3],
  ["president", "President", "decision_maker", 4],
  ["managing\\s+director", "Managing Director", "decision_maker", 5],
  ["managing\\s+member", "Managing Member", "decision_maker", 6],
  ["managing\\s+partner", "Managing Partner", "decision_maker", 6],
  ["principal", "Principal", "decision_maker", 6],
  ["general\\s+manager", "General Manager", "decision_maker", 7],
  ["operations\\s+manager", "Operations Manager", "decision_maker", 8],
  ["director\\s+of\\s+operations", "Director of Operations", "decision_maker", 8],
  ["operations\\s+director", "Operations Director", "decision_maker", 8],
  ["sales\\s+manager", "Sales Manager", "decision_maker", 9],
  ["director\\s+of\\s+sales", "Director of Sales", "decision_maker", 9],
  ["sales\\s+director", "Sales Director", "decision_maker", 9],
  ["business\\s+development\\s+manager", "Business Development Manager", "decision_maker", 10],
  ["director\\s+of\\s+business\\s+development", "Director of Business Development", "decision_maker", 10],
];
const TITLE_ALTS = TITLE_DEFS.map((d) => d[0])
  .sort((a, b) => b.length - a.length)
  .join("|");
const TERM = ci(
  "(?<![\\w-])(?<!vice )(?<!vice-)(?<!assistant )(?<!home )(?<!property )(?<!pet )(?<!to the )" + `(?:${TITLE_ALTS})(?![\\w-])`,
);
const TITLE = `(${TERM}(?:\\s*(?:&|and|/|,)\\s*${TERM}){0,2})`;

// ------------------------------------------------------------------- names
const W = "[A-Z][a-zA-Z'’]+(?:-[A-Z][a-z]+)?";
const NAME = `(?:(?:Mr|Mrs|Ms|Dr)\\.?[ ]+)?(${W}(?:[ ]+[A-Z]\\.)?(?:[ ]+(?:(?:van|von|de|du|der|le|la)[ ]+)?${W}){1,2})`;
const THE_OUR = ci("the|our");

type Kind = "name_title" | "title_name" | "by" | "verb";
const PATTERNS: [Kind, RegExp][] = [
  // John Smith, Founder · John Smith - Owner · John Smith (CEO) · John Smith ¦ Owner
  ["name_title", new RegExp(`${NAME}\\s*(?:,|-|–|—|\\||\\(|¦|:)\\s*(?:(?:${THE_OUR})\\s+)?${TITLE}`, "g")],
  // John Smith is the owner
  ["name_title", new RegExp(`${NAME},?\\s+(?:${ci("is|was|serves\\s+as|as")})\\s+(?:(?:${THE_OUR})\\s+)?${TITLE}`, "g")],
  // Owner: John Smith · Founder John Smith
  ["title_name", new RegExp(`${TITLE}\\s*(?::|-|–|—|,)?\\s*${NAME}`, "g")],
  // owned by John Smith · founded by John Smith
  ["by", new RegExp(`(?:${ci("(owned(?:\\s+and\\s+operated)?|founded|started|established)\\s+by")})\\s+${NAME}`, "g")],
  // John Smith founded / owns
  ["verb", new RegExp(`${NAME}\\s+(?:${ci("(founded|started|established|owns)")})\\b`, "g")],
];

const STOP = new Set([
  "about", "us", "contact", "home", "our", "the", "team", "meet", "staff", "company", "llc",
  "inc", "corp", "ltd", "services", "service", "roofing", "plumbing", "construction",
  "heating", "cooling", "electric", "electrical", "landscaping", "cleaning", "painting",
  "group", "solutions", "general", "manager", "owner", "founder", "president", "ceo",
  "director", "managing", "operations", "sales", "business", "development", "licensed",
  "insured", "family", "local", "free", "call", "email", "phone", "welcome", "since", "new",
  "best", "top", "view", "read", "more", "click", "here", "reviews", "review", "profile",
  "linkedin", "facebook", "yelp", "bbb", "google", "north", "south", "east", "west", "street",
  "avenue", "road", "operated", "and", "your", "we", "my", "he", "she", "his", "her", "with",
  "for", "from", "in", "at", "by", "of", "to", "is", "was", "has", "says", "said", "told",
  "will", "who", "that", "this", "their", "they", "it", "its", "on", "or", "an", "as",
  "member", "partner", "principal", "proprietor", "chief", "executive", "officer", "status",
  "active", "office", "main", "direct", "line", "january", "february", "march", "april",
  "june", "july", "august", "september", "october", "november", "december", "monday",
  "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "demo", "record",
  "entity", "supplies", "contractors", "contractor", "repair", "repairs", "pros",
  "experts", "today", "now", "get", "learn", "see", "find", "also", "current", "former",
  "serving", "located", "based", "customers", "clients", "years", "experience",
  ...Object.keys(US_STATES).flatMap((state) => state.split(" ")),
]);

const PARTICLES = new Set(["van", "von", "de", "du", "der", "le", "la"]);

export interface PersonMention {
  name: string;
  title: string;
  roleClass: "owner" | "decision_maker";
  rank: number;
  start: number;
  end: number;
}

function cleanName(raw: string, extraStops: Set<string>, companyTokens: Set<string>): string | null {
  const tokens = splitWords(raw);
  const isStop = (token: string) => {
    const t = stripChars(token.toLowerCase(), ".,'’");
    return STOP.has(t) || extraStops.has(t);
  };
  while (tokens.length && isStop(tokens[0])) tokens.shift();
  while (tokens.length && isStop(tokens[tokens.length - 1])) tokens.pop();
  const words = tokens.filter((t) => !PARTICLES.has(t.toLowerCase()) && !/^[A-Z]\.$/.test(t));
  if (words.length < 2 || words.length > 3) return null;
  if (words.some(isStop)) return null;
  if (words.some((t) => isUpper(t) && t.length > 3)) return null; // shouting words are rarely names
  if (words.every((t) => companyTokens.has(t.toLowerCase()))) return null;
  return tokens.join(" ");
}

const fullMatch = (pattern: string, value: string) => new RegExp(`^(?:${pattern})$`, "i").test(value);

/** [display title, role class, rank] for a matched title phrase. */
function parseTitle(raw: string): [string, "owner" | "decision_maker", number] {
  const parts: string[] = [];
  let role: "owner" | "decision_maker" = "decision_maker";
  let rank = 99;
  const terms: string[] = [];
  for (const term of raw.split(/\s*(?:&|\band\b|,)\s*/i)) {
    // keep "owner/operator" whole, but split "President/Owner"
    const whole = TITLE_DEFS.some((d) => fullMatch(d[0], term.trim()));
    terms.push(...(whole ? [term] : term.split("/")));
  }
  for (const term of terms) {
    for (const [pattern, canonical, cls, priority] of TITLE_DEFS) {
      if (fullMatch(pattern, term.trim())) {
        parts.push(canonical);
        rank = Math.min(rank, priority);
        if (cls === "owner") role = "owner";
        break;
      }
    }
  }
  return [parts.join(" & ") || raw.trim(), role, rank];
}

export function extractPeople(text: string, companyName = "", locationWords: string[] = []): PersonMention[] {
  const companyTokens = new Set(nameTokens(companyName));
  const extra = new Set(locationWords.flatMap((loc) => splitWords(loc ?? "").map((w) => w.toLowerCase())));
  const mentions: PersonMention[] = [];
  for (const [kind, pattern] of PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      let rawName: string;
      let rawTitle: string;
      if (kind === "name_title") [rawName, rawTitle] = [match[1], match[2]];
      else if (kind === "title_name") [rawTitle, rawName] = [match[1], match[2]];
      else if (kind === "by") {
        rawName = match[2];
        rawTitle = /^(founded|started|established)/.test(match[1].toLowerCase()) ? "founder" : "owner";
      } else {
        rawName = match[1];
        rawTitle = match[2].toLowerCase() === "owns" ? "owner" : "founder";
      }
      const name = cleanName(rawName, extra, companyTokens);
      if (!name) continue;
      const end = match.index! + match[0].length;
      if (kind === "name_title" && titleBelongsElsewhere(text.slice(end), companyTokens)) continue;
      const [title, role, rank] = parseTitle(rawTitle);
      mentions.push({ name, title, roleClass: role, rank, start: match.index!, end });
    }
  }
  return mentions;
}

/** True for 'Jane Doe, CEO of Some Other Corp' when that is not the company we research. */
function titleBelongsElsewhere(rest: string, companyTokens: Set<string>): boolean {
  const match = /^\s*(?:of|at|for|with)\s+((?:[A-Z0-9][\w&'’.-]*\s*){1,5})/.exec(rest);
  if (!match || !companyTokens.size) return false;
  return !nameTokens(match[1]).some((t) => companyTokens.has(t));
}

// ------------------------------------------------------------------ emails
const EMAIL_RE = /[A-Za-z0-9][A-Za-z0-9._%+\-]*@[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)+/g;
const BAD_EMAIL_TLDS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "css", "js", "ico"]);
const PLACEHOLDER_LOCALS = new Set(["you", "name", "email", "user", "yourname", "username", "example", "youremail", "your.name", "firstname.lastname", "someone"]);
const PLACEHOLDER_DOMAINS = new Set(["example.com", "domain.com", "email.com", "yourdomain.com", "company.com", "sentry.io", "wixpress.com", "sentry-next.wixpress.com"]);
export const GENERIC_LOCALS = new Set([
  "info", "contact", "sales", "support", "office", "hello", "admin", "enquiries",
  "inquiries", "service", "team", "mail", "help", "customerservice", "estimates",
  "quotes", "bookings", "reception", "general",
]);
export const FREEMAIL_DOMAINS = new Set(["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "aol.com", "icloud.com", "live.com", "msn.com", "comcast.net", "me.com", "ymail.com"]);

/** "a@b@c" -> ["a", "b@c"] (Python's str.partition("@")). */
export function splitEmail(email: string): [string, string] {
  const at = email.indexOf("@");
  return at < 0 ? [email, ""] : [email.slice(0, at), email.slice(at + 1)];
}

export function extractEmails(text: string): [string, number][] {
  const found: [string, number][] = [];
  for (const match of text.matchAll(EMAIL_RE)) {
    const email = match[0].replace(/\.+$/, "").toLowerCase();
    const [local, domain] = splitEmail(email);
    if (BAD_EMAIL_TLDS.has(domain.slice(domain.lastIndexOf(".") + 1))) continue;
    if (PLACEHOLDER_LOCALS.has(local) || PLACEHOLDER_DOMAINS.has(domain)) continue;
    if (local.length > 40 || /^[0-9a-f]{16,}$/.test(local)) continue;
    found.push([email, match.index!]);
  }
  return found;
}

// ------------------------------------------------------------------ phones
const PHONE_RES = [
  // North American: (503) 555-0142 · 503-555-0142 · +1 503.555.0142
  /(?<![\d\w])(?:\+?1[\s.\-]?)?\(?[2-9]\d{2}\)?[\s.\-]?\d{3}[\s.\-]\d{4}(?!\d)/g,
  // International with explicit country code: +27 11 555 0142
  /(?<![\d\w])\+\d{1,3}[\s.\-]?\(?\d{1,4}\)?(?:[\s.\-]?\d{2,4}){2,4}(?!\d)/g,
  // National format with trunk zero: 011 555 0142 · 020 7946 0958
  /(?<![\d\w])0\d{1,4}[\s.\-]\d{3,4}[\s.\-]\d{3,4}(?!\d)/g,
];

/** [as written, digits, position] for each phone number in the text, in text order. */
export function extractPhones(text: string): [string, string, number][] {
  const found = new Map<number, [string, string, number]>();
  const taken: [number, number][] = [];
  for (const pattern of PHONE_RES) {
    for (const match of text.matchAll(pattern)) {
      const start = match.index!;
      const end = start + match[0].length;
      if (taken.some(([s, e]) => start < e && end > s)) continue;
      const digits = phoneDigits(match[0]);
      if (digits.length < 9 || digits.length > 15) continue;
      taken.push([start, end]);
      found.set(start, [match[0].trim(), digits, start]);
    }
  }
  return [...found.keys()].sort((a, b) => a - b).map((k) => found.get(k)!);
}

// --------------------------------------------------------------- addresses
const ADDRESS_RE = new RegExp(
  "\\b\\d{1,6}\\s+(?:[A-Za-z0-9.'-]+\\s){1,5}?" +
    "(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Way|Highway|Hwy|Court|Ct|" +
    "Place|Pl|Parkway|Pkwy)\\b\\.?" +
    "(?:,?\\s*(?:Suite|Ste\\.?|Unit|#)\\s*[\\w-]+)?" +
    "(?:,\\s*[A-Za-z .'-]{2,40},\\s*[A-Z]{2}(?:\\s+\\d{5}(?:-\\d{4})?)?)?",
  "g",
);

export function extractAddresses(text: string): string[] {
  return [...text.matchAll(ADDRESS_RE)].map((m) => stripChars(m[0], " ,."));
}

export function excerpt(text: string, start: number, end: number, radius = 110): string {
  const left = Math.max(0, start - radius);
  const right = Math.min(text.length, end + radius);
  return (left ? "…" : "") + text.slice(left, right).trim() + (right < text.length ? "…" : "");
}
