import crypto from 'crypto';
import { isBlocked, recordFailure, clearFailures } from '../utils/rateLimit.js';

const safeEqual = (a, b) =>
  a.length > 0 && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

/* ---------- Zawadie Hub single sign-on ----------
 * The hub (hub-server/server.js: signHubIdentity) adds a signed identity to every request it proxies to this app:
 *   X-Zawadie-User-Email / -Role / -Ts / -Sig, where Sig = HMAC-SHA256(ZAWADIE_SSO_SECRET, `${email}|${role}|${ts}`).
 * The hub only proxies to users who are signed in AND have access to this project, so a valid signature means the
 * person already passed the hub's login and does not need the shared access keys below.
 * Set ZAWADIE_SSO_SECRET to the same value as the hub's. If it is unset, SSO is off and the keys are required as before. */
const MAX_SKEW_MS = 5 * 60 * 1000;

/** Returns { email, role } when the hub has already identified this request, otherwise null. */
export function verifyHubUser(req) {
  // Built in: running inside the hub's own process (see ../../hub.js), the hub hands over the
  // already-checked user directly as req.hubUser (server.js: handOverUser) — no header to verify,
  // since there's no longer a proxy hop between the hub and this app. Only reached when mounted
  // standalone behind a reverse proxy (e.g. BAM_LOCAL_AGENT_URL) does the signature check below apply.
  if (req.hubUser) return { email: String(req.hubUser.email).toLowerCase(), role: String(req.hubUser.role) };

  const secret = process.env.ZAWADIE_SSO_SECRET;
  if (!secret) return null;
  const email = req.get('x-zawadie-user-email');
  const role = req.get('x-zawadie-user-role');
  const ts = req.get('x-zawadie-user-ts');
  const sig = req.get('x-zawadie-user-sig');
  if (!email || !role || !ts || !sig) return null;
  if (!/^\d+$/.test(ts) || Math.abs(Date.now() - Number(ts)) > MAX_SKEW_MS) return null;
  const expected = crypto.createHmac('sha256', secret).update(`${email}|${role}|${ts}`).digest('hex');
  if (!/^[0-9a-f]+$/i.test(sig) || sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig.toLowerCase(), 'hex'), Buffer.from(expected, 'hex'))) return null;
  return { email: String(email).toLowerCase(), role: String(role) };
}

/* Which hub roles may skip the key. Hub admins manage everything; any other hub user who was granted this project may
 * use the marketing planner. Playbook uploads, store changes and knowledge edits stay admin-only (they can also still
 * sign in with ADMIN_API_KEY). To let every hub user into the admin portal, add 'employee' to ADMIN_HUB_ROLES. */
const ADMIN_HUB_ROLES = ['admin'];
const TEAM_HUB_ROLES = ['admin', 'employee'];

/** What the pages need to know on load: who is signed in through the hub and what they can open without a key. */
export function sessionInfo(req) {
  const user = verifyHubUser(req);
  return {
    sso: !!user,
    email: user?.email ?? null,
    role: user?.role ?? null,
    canAdmin: !!user && ADMIN_HUB_ROLES.includes(user.role),
    canPlan: !!user && TEAM_HUB_ROLES.includes(user.role)
  };
}

/** Hub sign-in first; otherwise the shared secret with brute-force protection (8 wrong keys from one IP = 15 minute lockout). */
function guard(envName, header, hubRoles, { notConfigured }) {
  return (req, res, next) => {
    const user = verifyHubUser(req);
    if (user && hubRoles.includes(user.role)) { req.hubUser = user; return next(); }

    const expected = process.env[envName] || '';
    if (!expected) return res.status(503).json({ error: notConfigured });
    if (isBlocked(req.ip)) return res.status(429).json({ error: 'Too many incorrect attempts. Please try again in 15 minutes.' });
    if (safeEqual(req.get(header) || '', expected)) { clearFailures(req.ip); return next(); }
    recordFailure(req.ip);
    return res.status(401).json({ error: 'Unauthorized' });
  };
}

/** Admin portal and /api/admin/*: hub admin, or header x-admin-key = ADMIN_API_KEY. */
export const requireAdminKey = guard('ADMIN_API_KEY', 'x-admin-key', ADMIN_HUB_ROLES, {
  notConfigured: 'Admin access is not configured. Set ADMIN_API_KEY in .env.'
});

/** Marketing planner (/ask, /api/ask): any hub user with access, or header x-team-key = TEAM_ACCESS_KEY. Separate from the admin key. */
export const requireTeamKey = guard('TEAM_ACCESS_KEY', 'x-team-key', TEAM_HUB_ROLES, {
  notConfigured: 'Team access is not set up yet. Ask an admin to set TEAM_ACCESS_KEY.'
});
