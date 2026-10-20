/** Text, company-name, domain, phone and person-name normalisation helpers. */

export const COMPANY_SUFFIXES = new Set([
  "llc", "inc", "incorporated", "corp", "corporation", "co", "company", "ltd", "limited",
  "pty", "plc", "lp", "llp", "pllc", "gmbh", "cc",
]);

export const US_STATES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS",
  missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH",
  "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC",
  "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA",
  "rhode island": "RI", "south carolina": "SC", "south dakota": "SD", tennessee: "TN",
  texas: "TX", utah: "UT", vermont: "VT", virginia: "VA", washington: "WA",
  "west virginia": "WV", wisconsin: "WI", wyoming: "WY", "district of columbia": "DC",
};
const ABBR_TO_STATE: Record<string, string> = Object.fromEntries(Object.entries(US_STATES).map(([name, abbr]) => [abbr, name]));

const TWO_LEVEL_TLDS = new Set([
  "co.uk", "org.uk", "gov.uk", "co.za", "org.za", "gov.za", "com.au", "net.au", "gov.au",
  "co.nz", "com.br", "co.in", "com.mx", "co.jp", "com.sg", "gc.ca",
]);

export function cleanText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/** Lower-case and replace punctuation with spaces (for phrase/token matching). */
export function normalizeText(value: string | null | undefined): string {
  const text = (value ?? "").toLowerCase().replaceAll("&", " and ");
  return text.replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

export function nameTokens(companyName: string | null | undefined): string[] {
  const tokens = splitWords(normalizeText(companyName)).filter((t) => t !== "the" && t !== "and");
  const core = tokens.filter((t) => !COMPANY_SUFFIXES.has(t));
  return core.length ? core : tokens;
}

export const normalizeCompanyName = (name: string | null | undefined) => nameTokens(name).join(" ");
export const compactName = (name: string | null | undefined) => nameTokens(name).join("");

export function hostOf(url: string | null | undefined): string {
  if (!url) return "";
  let value = url.trim();
  if (!value.includes("://")) value = "http://" + value;
  let host: string;
  try {
    host = new URL(value).hostname;
  } catch {
    return "";
  }
  host = host.toLowerCase();
  return host.startsWith("www.") ? host.slice(4) : host;
}

/** Naive registrable domain: last two labels, or three for known two-level TLDs. */
export function registeredDomain(url: string | null | undefined): string {
  const host = hostOf(url);
  const labels = host.split(".");
  if (labels.length <= 2) return host;
  if (TWO_LEVEL_TLDS.has(labels.slice(-2).join("."))) return labels.slice(-3).join(".");
  return labels.slice(-2).join(".");
}

/** The name part of a registrable domain, without hyphens (abc-roofing.com -> abcroofing). */
export function domainLabel(domain: string): string {
  return domain ? domain.split(".")[0].toLowerCase().replace(/[^a-z0-9]/g, "") : "";
}

export function phoneDigits(phone: string | null | undefined): string {
  let digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  return digits;
}

/** [full lower-case name, upper-case abbreviation] for a US state, else [value, ""]. */
export function stateForms(state: string | null | undefined): [string, string] {
  const value = cleanText(state);
  if (!value) return ["", ""];
  if (ABBR_TO_STATE[value.toUpperCase()]) return [ABBR_TO_STATE[value.toUpperCase()], value.toUpperCase()];
  if (US_STATES[value.toLowerCase()]) return [value.toLowerCase(), US_STATES[value.toLowerCase()]];
  return [value.toLowerCase(), ""];
}

/** First + last name, lower-cased, ignoring honorifics and middle initials. */
export function personKey(name: string | null | undefined): string {
  const tokens = splitWords(cleanText(name))
    .map((t) => stripChars(t, ".,"))
    .filter((t) => t && !["mr", "mrs", "ms", "dr"].includes(t.toLowerCase()) && t.length > 1);
  if (tokens.length < 2) return tokens.join(" ").toLowerCase();
  return `${tokens[0]} ${tokens[tokens.length - 1]}`.toLowerCase();
}

// ---------------------------------------------------------------- Python-isms
// Small helpers so the ported logic keeps Python's exact string semantics.

/** str.split() with no argument: split on runs of whitespace, no empty strings. */
export function splitWords(value: string): string[] {
  return value.split(/\s+/).filter(Boolean);
}

/** str.strip(chars). */
export function stripChars(value: string, chars: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && chars.includes(value[start])) start++;
  while (end > start && chars.includes(value[end - 1])) end--;
  return value.slice(start, end);
}

/** str.title(). */
export function titleCase(value: string): string {
  return value.toLowerCase().replace(/(^|[^a-zA-Z])([a-z])/g, (_m, pre: string, ch: string) => pre + ch.toUpperCase());
}

/** str.isupper(): has a cased character and every cased character is upper-case. */
export function isUpper(value: string): boolean {
  return /[A-Za-z]/.test(value) && value === value.toUpperCase();
}

/** Python's round(): half-to-even ("banker's rounding"). */
export function pyRound(value: number, digits = 0): number {
  const factor = 10 ** digits;
  const scaled = value * factor;
  const floor = Math.floor(scaled);
  const diff = scaled - floor;
  let rounded: number;
  if (Math.abs(diff - 0.5) < 1e-9) rounded = floor % 2 === 0 ? floor : floor + 1;
  else rounded = Math.round(scaled);
  return rounded / factor;
}

/** max(items, key=...): the FIRST item with the largest key. */
export function maxBy<T>(items: T[], key: (item: T) => number): T | undefined {
  let best: T | undefined;
  let bestKey = -Infinity;
  for (const item of items) {
    const k = key(item);
    if (best === undefined || k > bestKey) {
      best = item;
      bestKey = k;
    }
  }
  return best;
}

/** min(items, key=...): the FIRST item with the smallest key. */
export function minBy<T>(items: T[], key: (item: T) => number): T | undefined {
  let best: T | undefined;
  let bestKey = Infinity;
  for (const item of items) {
    const k = key(item);
    if (best === undefined || k < bestKey) {
      best = item;
      bestKey = k;
    }
  }
  return best;
}

export const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\\/-]/g, "\\$&");
