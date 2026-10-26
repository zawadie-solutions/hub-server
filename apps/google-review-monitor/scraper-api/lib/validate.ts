import { createHash, timingSafeEqual } from "node:crypto";

/** Bearer token check in constant time (hashing first makes the lengths equal). */
export function authorized(header: string | string[] | undefined, secret: string | undefined): boolean {
  if (!secret) return false; // never run open: no secret configured means nobody gets in
  const value = Array.isArray(header) ? header[0] : header;
  const match = /^Bearer\s+(.+)$/i.exec(value ?? "");
  if (!match) return false;
  const a = createHash("sha256").update(match[1].trim()).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b);
}

/**
 * Only Google review links: a maps.app.goo.gl short link, or a google.<tld>/maps page. Anything
 * else is refused, so the API can't be used as an open proxy or to reach internal addresses.
 */
export function allowedReviewUrl(raw: unknown): URL | null {
  if (typeof raw !== "string" || raw.length > 2000) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  if (host === "maps.app.goo.gl") return url;
  if (/^(www\.)?google\.[a-z]{2,3}(\.[a-z]{2})?$/.test(host) && url.pathname.startsWith("/maps")) return url;
  return null;
}
