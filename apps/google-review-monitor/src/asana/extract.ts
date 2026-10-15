const URL_RE = /https?:\/\/[^\s<>"'\])]+/gi;

const GOOGLE_HOSTS = [
  /^(www\.)?google\.[a-z.]+$/i, // path must start with /maps or /local, checked below
  /^maps\.google\.[a-z.]+$/i,
  /^maps\.app\.goo\.gl$/i,
  /^goo\.gl$/i,
  /^g\.page$/i,
  /^search\.google\.com$/i,
  /^share\.google$/i,
];

function decodeEntities(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&#x2F;/gi, "/").replace(/&quot;/g, '"');
}

function clean(u: string): string {
  return decodeEntities(u).replace(/[.,;:!?]+$/, "");
}

/** True if the URL looks like a link to a Google Maps place/review. */
export function isGoogleReviewUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  const host = u.hostname;
  if (!GOOGLE_HOSTS.some((re) => re.test(host))) return false;
  if (/^(www\.)?google\./i.test(host)) return /^\/(maps|local)/i.test(u.pathname);
  if (host === "search.google.com") return /^\/local\//i.test(u.pathname);
  if (host === "goo.gl") return /^\/maps/i.test(u.pathname);
  return true;
}

/** All distinct URLs in plain text and in href attributes of Asana's html_notes. */
export function extractUrls(notes: string | null | undefined, htmlNotes?: string | null): string[] {
  const found: string[] = [];
  for (const m of (notes ?? "").matchAll(URL_RE)) found.push(clean(m[0]));
  for (const m of (htmlNotes ?? "").matchAll(/href="([^"]+)"/gi)) found.push(clean(m[1]));
  return [...new Set(found)];
}

/** Pick the most likely Google review link; null if the task has none. */
export function pickGoogleReviewUrl(notes: string | null | undefined, htmlNotes?: string | null): string | null {
  const candidates = extractUrls(notes, htmlNotes).filter(isGoogleReviewUrl);
  if (candidates.length === 0) return null;
  const score = (u: string) => (/review/i.test(u) ? 2 : 0) + (/data=/i.test(u) ? 1 : 0);
  return [...candidates].sort((a, b) => score(b) - score(a))[0]; // stable: keeps description order on ties
}

// "Mike Andrews : https://maps.app.goo.gl/..." or "Mike Andrews - https://..." — the name sits before the link.
const NAME_BEFORE_URL_RE = /^\s*([^:\n/]{2,80}?)\s*(?::|[-–](?=\s*https?:))\s*https?:\/\//im;

/** A short line that reads as a person or business name, not a sentence of review text. */
function looksLikeName(s: string): boolean {
  return s.length >= 2 && s.length <= 60 && s.split(/\s+/).length <= 5 && !/[.!?]\s|[!?]$|https?:/i.test(s);
}

export function parseReviewerName(notes: string | null | undefined): string | null {
  const text = notes ?? "";
  const labelled = text.match(/^\s*(?:reviewer(?:\s*name)?|review\s*author|author)\s*[:\-–]\s*(.+?)\s*$/im);
  if (labelled) return labelled[1].trim();
  const beforeUrl = text.match(NAME_BEFORE_URL_RE);
  if (beforeUrl) return beforeUrl[1].trim();
  // A description that is only the name, e.g. "Kelley Williams" or "Akshat Sharma -" above the link.
  const lines = text
    .split("\n")
    .map((l) => l.replace(URL_RE, "").replace(/[\s:\-–]+$/, "").trim())
    .filter(Boolean);
  return lines.length === 1 && looksLikeName(lines[0]) ? lines[0] : null;
}

/**
 * "Dispute 1: Google - Mike Andrews", "Dispute 3 Google-Kimberly Dickson" and
 * "Dispute 1: Google - Laura Lewis-Barr" -> the name after the first hyphen;
 * null when nothing follows it ("Dispute 2", "Dispute 2 Google-").
 */
export function parseReviewerFromTitle(title: string | null | undefined): string | null {
  const m = (title ?? "").match(/^[^-–]*[-–]\s*(.+?)\s*$/);
  return m ? m[1].trim() : null;
}

export function parseRating(notes: string | null | undefined): number | null {
  const text = notes ?? "";
  const m =
    text.match(/(?:rating|stars?)\s*[:\-–]?\s*([1-5])\b/i) ?? text.match(/\b([1-5])\s*(?:-?\s*stars?|★)/i);
  return m ? Number(m[1]) : null;
}

/**
 * The review's own text: a "Review:"/"Comment:" line (and following lines) if present,
 * otherwise the description with URLs and the Reviewer/Rating lines removed.
 */
export function parseReviewText(notes: string | null | undefined): string | null {
  const text = notes ?? "";
  const labelled = text.match(/^\s*(?:review(?:\s*text)?|comment|review\s*content)\s*[:\-–]\s*([\s\S]+)$/im);
  const body = labelled
    ? labelled[1]
    : text
        .split("\n")
        .filter((l) => !/^\s*(?:reviewer(?:\s*name)?|review\s*author|author|rating|stars?)\s*[:\-–]/i.test(l))
        .filter((l) => !NAME_BEFORE_URL_RE.test(l))
        .join("\n");
  const cleaned = body.replace(URL_RE, "").replace(/[ \t]+\n/g, "\n").trim();
  return cleaned ? cleaned.slice(0, 2000) : null;
}
