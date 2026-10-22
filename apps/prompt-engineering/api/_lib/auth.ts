import { createHmac, timingSafeEqual } from 'node:crypto'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getSql } from './db.js'

const SESSION_COOKIE = 'pe_session'
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30 // 30 days

// Shared with the Zawadie Hub (hub-server/data/sso-secret.txt) so this app
// trusts a login that already happened there instead of running its own.
const SSO_SECRET = process.env.ZAWADIE_SSO_SECRET || ''
const MAX_SKEW_MS = 5 * 60 * 1000

function parseCookies(header?: string | null): Record<string, string> {
  const out: Record<string, string> = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const idx = part.indexOf('=')
    if (idx === -1) continue
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim())
  }
  return out
}

export function clearSessionCookie(res: VercelResponse) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`)
}

export async function destroySession(req: VercelRequest) {
  const token = parseCookies(req.headers.cookie).pe_session
  if (!token) return
  const sql = getSql()
  await sql`DELETE FROM sessions WHERE token = ${token}`
}

export interface SessionUser {
  id: number
  email: string
  display_name: string
}

function verifyHubHeaders(req: VercelRequest): { email: string } | null {
  // Running inside the hub (see hub.ts): it has already checked the login and
  // hands the user over directly (a request property, which no client can set).
  const hubUser = (req as VercelRequest & { hubUser?: { email: string } }).hubUser
  if (hubUser) return { email: hubUser.email.toLowerCase() }
  if (!SSO_SECRET) return null
  const email = req.headers['x-zawadie-user-email']
  const role = req.headers['x-zawadie-user-role']
  const ts = req.headers['x-zawadie-user-ts']
  const sig = req.headers['x-zawadie-user-sig']
  if (typeof email !== 'string' || typeof role !== 'string' || typeof ts !== 'string' || typeof sig !== 'string') {
    return null
  }
  if (Math.abs(Date.now() - Number(ts)) > MAX_SKEW_MS) return null

  const expected = createHmac('sha256', SSO_SECRET).update(`${email}|${role}|${ts}`).digest('hex')
  const sigBuf = Buffer.from(sig, 'hex')
  const expBuf = Buffer.from(expected, 'hex')
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null

  return { email: email.toLowerCase() }
}

function displayNameFromEmail(email: string) {
  return email
    .split('@')[0]
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(' ')
}

// Finds the account for a hub-verified email, creating one on first sight.
// Reuses any row already created back when this app had its own signup, so
// existing progress/leaderboard history for that email carries forward.
async function getOrCreateHubUser(email: string): Promise<SessionUser> {
  const sql = getSql()
  const existing = (await sql`SELECT id, email, display_name FROM users WHERE email = ${email}`) as SessionUser[]
  if (existing[0]) return existing[0]

  const inserted = (await sql`
    INSERT INTO users (email, display_name)
    VALUES (${email}, ${displayNameFromEmail(email)})
    ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
    RETURNING id, email, display_name
  `) as SessionUser[]
  return inserted[0]
}

export async function getUserFromRequest(req: VercelRequest): Promise<SessionUser | null> {
  const hubUser = verifyHubHeaders(req)
  if (hubUser) return getOrCreateHubUser(hubUser.email)

  // Fallback for direct/standalone access without the hub (e.g. local dev
  // before ZAWADIE_SSO_SECRET is set) — only reachable by a session cookie
  // issued before self-signup was removed in favor of hub-only access.
  const token = parseCookies(req.headers.cookie).pe_session
  if (!token) return null
  const sql = getSql()
  const rows = (await sql`
    SELECT u.id, u.email, u.display_name
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ${token} AND s.expires_at > now()
  `) as SessionUser[]
  return rows[0] ?? null
}
