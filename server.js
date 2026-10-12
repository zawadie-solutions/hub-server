// Zawadie Solutions Hub — login-gated router for ai.zawadie.com (local dev).
//
// Serves the hub + login + admin pages (server-rendered, see views/), and
// reverse-proxies each solution's path to the real app already running on
// its own localhost port. Each backend's own frontend code was made
// relative-path / base-path aware (see ombeni-ai/public/app.js,
// Prompt-Engineering/vite.config.ts and Face-match-system's static page) so
// it works both standalone on its own port and here, behind a path prefix.
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const session = require('express-session');
const { createProxyMiddleware } = require('http-proxy-middleware');

const SOLUTIONS = require('./solutions');
const users = require('./store/users');
const { getSessionSecret } = require('./store/secret');
const { getSsoSecret } = require('./store/ssoSecret');
const { requireLogin, requireAdmin, requireSolutionAccess } = require('./middleware/auth');

const SSO_SECRET = getSsoSecret();

// Signs the signed-in user's identity so a proxied solution can trust it
// instead of showing its own login screen. Verified by each solution with
// the same ZAWADIE_SSO_SECRET value (see store/ssoSecret.js).
function signHubIdentity(user) {
  const ts = Date.now().toString();
  const sig = crypto.createHmac('sha256', SSO_SECRET).update(`${user.email}|${user.role}|${ts}`).digest('hex');
  return { 'X-Zawadie-User-Email': user.email, 'X-Zawadie-User-Role': user.role, 'X-Zawadie-User-Ts': ts, 'X-Zawadie-User-Sig': sig };
}

const ZAWADIE_EMAIL_RE = /^[^\s@]+@zawadie\.com$/i;

users.ensureSeeded(SOLUTIONS.map((s) => s.id));

const app = express();
// Without this, Express treats "/ombeni-ai" and "/ombeni-ai/" as the same
// route, so the redirect-to-trailing-slash handler below would also catch
// (and re-redirect) the already-correct trailing-slash URL.
app.set('strict routing', true);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(
  session({
    // Named explicitly (not the express-session default "connect.sid") so
    // this cookie can't collide with a proxied solution's own session
    // cookie — both are set under the same origin once proxied.
    name: 'zawadie_hub.sid',
    secret: getSessionSecret(),
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 24 * 7 },
  })
);

function nameFromEmail(email) {
  return email
    .split('@')[0]
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function solutionsFor(sessionUser) {
  if (!sessionUser) return [];
  if (sessionUser.role === 'admin') return SOLUTIONS;
  return SOLUTIONS.filter((s) => (sessionUser.solutions || []).includes(s.id));
}

function safeNext(value) {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : '/';
}

function toIdList(raw) {
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.filter((id) => SOLUTIONS.some((s) => s.id === id));
}

function inviteUrl(req, token) {
  return `${req.protocol}://${req.get('host')}/invite/${token}`;
}

// ---------------- auth ----------------

app.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('login', { error: null, emailValue: '', next: req.query.next || '' });
});

app.post('/login', (req, res) => {
  const email = (req.body.email || '').trim();
  const password = req.body.password || '';
  const next = req.query.next || '';

  if (!ZAWADIE_EMAIL_RE.test(email)) {
    return res.status(401).render('login', { error: 'Access is limited to @zawadie.com accounts.', emailValue: email, next });
  }

  const record = users.findByEmail(email);
  if (!record || !users.verifyPassword(password, record.passwordHash)) {
    return res.status(401).render('login', { error: 'Incorrect email or password.', emailValue: email, next });
  }

  req.session.regenerate((err) => {
    if (err) return res.status(500).render('login', { error: 'Something went wrong. Try again.', emailValue: email, next });
    req.session.user = { email: record.email, role: record.role, solutions: record.solutions || [] };
    res.redirect(safeNext(next));
  });
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

app.get('/invite/:token', (req, res) => {
  const record = users.findByInviteToken(req.params.token);
  if (!record || record.passwordHash) {
    return res.status(400).render('invite', { error: 'This invite link is invalid or has already been used.', email: null, token: null });
  }
  if (users.isInviteExpired(record)) {
    return res.status(400).render('invite', { error: 'This invite link has expired. Ask your admin to resend it.', email: null, token: null });
  }
  res.render('invite', { error: null, email: record.email, token: record.inviteToken });
});

app.post('/invite/:token', (req, res) => {
  const record = users.findByInviteToken(req.params.token);
  const fail = (error, email, token) => res.status(400).render('invite', { error, email, token });

  if (!record || record.passwordHash) return fail('This invite link is invalid or has already been used.', null, null);
  if (users.isInviteExpired(record)) return fail('This invite link has expired. Ask your admin to resend it.', null, null);

  const password = req.body.password || '';
  const confirm = req.body.confirm || '';
  if (password.length < 8) return fail('Password must be at least 8 characters.', record.email, record.inviteToken);
  if (password !== confirm) return fail('Passwords do not match.', record.email, record.inviteToken);

  const activated = users.acceptInvite(record.inviteToken, password);
  req.session.regenerate((err) => {
    if (err) return fail('Something went wrong. Try again.', record.email, record.inviteToken);
    req.session.user = { email: activated.email, role: activated.role, solutions: activated.solutions || [] };
    res.redirect('/');
  });
});

// ---------------- hub ----------------

function timeOfDayGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

app.get('/', requireLogin, (req, res) => {
  const mySolutions = solutionsFor(req.session.user);
  res.render('hub', {
    user: req.session.user,
    displayName: nameFromEmail(req.session.user.email),
    greeting: timeOfDayGreeting(),
    solutions: mySolutions,
    categories: [...new Set(mySolutions.map((s) => s.category))],
    availableCount: mySolutions.filter((s) => s.status === 'available').length,
    inDevCount: mySolutions.filter((s) => s.status !== 'available').length,
  });
});

// ---------------- admin ----------------

app.get('/admin', requireLogin, requireAdmin, (req, res) => {
  res.render('admin', {
    user: req.session.user,
    employees: users.all(),
    solutions: SOLUTIONS,
    error: null,
    notice: req.query.notice || null,
    inviteUrl: (token) => inviteUrl(req, token),
    inviteExpired: users.isInviteExpired,
  });
});

app.post('/admin/users', requireLogin, requireAdmin, (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const role = req.body.role === 'admin' ? 'admin' : 'employee';
  const solutionIds = toIdList(req.body.solutions);

  const fail = (error) =>
    res.status(400).render('admin', {
      user: req.session.user,
      employees: users.all(),
      solutions: SOLUTIONS,
      error,
      notice: null,
      inviteUrl: (token) => inviteUrl(req, token),
      inviteExpired: users.isInviteExpired,
    });

  if (!ZAWADIE_EMAIL_RE.test(email)) return fail('Email must end in @zawadie.com.');
  if (users.findByEmail(email)) return fail(`${email} already has an account.`);

  users.createInvite({
    email,
    role,
    // Admins bypass the per-solution check entirely (see requireSolutionAccess),
    // but store the full list too so the admin table reads consistently.
    solutions: role === 'admin' ? SOLUTIONS.map((s) => s.id) : solutionIds,
  });
  res.redirect('/admin?notice=' + encodeURIComponent(`Invite created for ${email}. Copy their link below and send it to them.`));
});

app.post('/admin/users/:email/access', requireLogin, requireAdmin, (req, res) => {
  const email = decodeURIComponent(req.params.email);
  const existing = users.findByEmail(email);
  if (!existing) return res.redirect('/admin');
  if (existing.role === 'admin') return res.redirect('/admin'); // admins always have full access

  users.addOrUpdate({ ...existing, solutions: toIdList(req.body.solutions) });
  res.redirect('/admin?notice=' + encodeURIComponent(`${existing.email}'s access was updated.`));
});

app.post('/admin/users/:email/resend-invite', requireLogin, requireAdmin, (req, res) => {
  const email = decodeURIComponent(req.params.email);
  const resent = users.resendInvite(email);
  if (!resent) return res.redirect('/admin');
  res.redirect('/admin?notice=' + encodeURIComponent(`A fresh invite link was generated for ${email}.`));
});

app.post('/admin/users/:email/delete', requireLogin, requireAdmin, (req, res) => {
  const email = decodeURIComponent(req.params.email);
  if (email.toLowerCase() === req.session.user.email.toLowerCase()) {
    return res.redirect('/admin?notice=' + encodeURIComponent('You cannot remove your own account.'));
  }
  users.remove(email);
  res.redirect('/admin?notice=' + encodeURIComponent(`${email} was removed.`));
});

// ---------------- solution proxies ----------------

for (const sol of SOLUTIONS) {
  if (sol.externalUrl) continue; // links straight out; nothing to proxy
  const prefix = `/${sol.id}`;

  app.get(prefix, requireSolutionAccess(sol.id), (req, res) => res.redirect(301, `${prefix}/`));

  app.use(
    prefix,
    requireSolutionAccess(sol.id),
    createProxyMiddleware({
      target: sol.target,
      changeOrigin: true,
      ws: true,
      // Express's app.use(prefix, ...) already strips the mount prefix off
      // req.url before this middleware ever sees it. For backends that need
      // the full prefixed path back (e.g. Vite's `base`), restore it from
      // req.originalUrl; otherwise leave Express's stripped path alone.
      pathRewrite: sol.stripPrefix ? undefined : (_p, req) => req.originalUrl,
      logLevel: 'warn',
      on: {
        error: (err, req, res) => {
          console.error(`[proxy] ${sol.id} unreachable:`, err.message);
          if (res.headersSent) return res.end();
          res.status(502).render('error', {
            user: req.session?.user || null,
            code: 502,
            message: `${sol.name} isn't reachable right now. Try again shortly.`,
          });
        },
        proxyReq: (proxyReq, req) => {
          // Lets the solution trust the hub's already-completed login
          // instead of showing its own, so there's only ever one sign-in.
          const identity = signHubIdentity(req.session.user);
          for (const [header, value] of Object.entries(identity)) proxyReq.setHeader(header, value);

          // Some backends also keep their own Basic Auth as defense in
          // depth behind the hub's login. Inject it so a signed-in
          // employee isn't prompted a second time.
          if (sol.basicAuth?.user && sol.basicAuth?.pass) {
            const token = Buffer.from(`${sol.basicAuth.user}:${sol.basicAuth.pass}`).toString('base64');
            proxyReq.setHeader('Authorization', `Basic ${token}`);
          }
        },
      },
    })
  );
}

app.use((req, res) => {
  res.status(404).render('error', { user: req.session.user || null, code: 404, message: "We couldn't find that page." });
});

// ---------------- boot ----------------

const DEFAULT_PORT = Number(process.env.PORT) || 80;
const FALLBACK_PORT = 8080;

function start(port) {
  const server = app.listen(port, () => {
    console.log(`Zawadie Solutions Hub listening on http://ai.zawadie.com${port === 80 ? '' : ':' + port}`);
    console.log('Routes:');
    for (const sol of SOLUTIONS) console.log(`  /${sol.id}/*  ->  ${sol.externalUrl || sol.target}`);
  });
  server.on('error', (err) => {
    if (err.code === 'EACCES' && port !== FALLBACK_PORT) {
      console.warn(`Port ${port} needs admin rights; falling back to ${FALLBACK_PORT}.`);
      start(FALLBACK_PORT);
    } else if (err.code === 'EADDRINUSE') {
      console.error(`Port ${port} is already in use. Is the hub already running?`);
      process.exit(1);
    } else {
      throw err;
    }
  });
}

start(DEFAULT_PORT);
