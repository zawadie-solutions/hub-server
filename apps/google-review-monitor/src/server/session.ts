import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Sign-in sessions for the dashboard, kept entirely in a signed cookie (nothing stored on
 * the server): `<user>.<expiry>.<signature>`. The signing key is derived from the dashboard
 * password, so changing the password signs everyone out.
 */

export const SESSION_COOKIE = "grm_session";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const b64 = (s: string) => Buffer.from(s).toString("base64url");
const key = (password: string) => createHash("sha256").update(`grm-session:${password}`).digest();
const sign = (payload: string, password: string) => createHmac("sha256", key(password)).update(payload).digest("base64url");

export function createSession(user: string, password: string, now = Date.now()): string {
  const payload = `${b64(user)}.${now + SESSION_TTL_MS}`;
  return `${payload}.${sign(payload, password)}`;
}

/** The signed-in user, or null if the token is missing, forged, altered or expired. */
export function verifySession(token: string | undefined, password: string, now = Date.now()): string | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [user, expiry, signature] = parts;
  const expected = Buffer.from(sign(`${user}.${expiry}`, password));
  const given = Buffer.from(signature);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  if (!/^\d+$/.test(expiry) || Number(expiry) <= now) return null;
  return Buffer.from(user, "base64url").toString();
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

/**
 * Slows down password guessing: after `max` wrong attempts from one address within the
 * window, further attempts are refused until the window has passed. Kept in memory.
 */
export class LoginThrottle {
  private attempts = new Map<string, { count: number; since: number }>();
  constructor(
    private max = 5,
    private windowMs = 10 * 60 * 1000,
  ) {}

  /** Minutes left to wait, or 0 if another attempt is allowed. */
  blockedFor(address: string, now = Date.now()): number {
    const a = this.attempts.get(address);
    if (!a) return 0;
    if (now - a.since >= this.windowMs) {
      this.attempts.delete(address);
      return 0;
    }
    return a.count >= this.max ? Math.ceil((a.since + this.windowMs - now) / 60_000) : 0;
  }

  failed(address: string, now = Date.now()): void {
    const a = this.attempts.get(address);
    if (!a || now - a.since >= this.windowMs) this.attempts.set(address, { count: 1, since: now });
    else a.count++;
  }

  succeeded(address: string): void {
    this.attempts.delete(address);
  }
}
