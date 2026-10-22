// Inside the Zawadie hub (see hub.js) every setting comes from the hub's shared .env with an
// OMBENI_ prefix (OMBENI_OPENAI_API_KEY, OMBENI_SLACK_BOT_TOKEN, ...), so names like
// SLACK_BOT_TOKEN, SESSION_SECRET or PORT can't clash with the hub's other apps.
// Standalone (`node server.js`) it reads this project's own .env, unprefixed.
const IN_HUB = process.env.OMBENI_IN_HUB === '1';
const PREFIX = IN_HUB ? 'OMBENI_' : '';

// override: true makes this project's .env win over any same-named variable
// already sitting in the OS environment (e.g. a stale OPENAI_API_KEY set at
// the Windows user/system level) — otherwise dotenv silently keeps the OS
// value and .env changes appear to do nothing. (The hub loads its own .env.)
if (!IN_HUB) require('dotenv').config({ override: true });

const read = (name) => process.env[PREFIX + name] || '';
const MONDAY_KEY_RE = new RegExp(`^${PREFIX}MONDAY_API_KEY(_\\d+)?$`);
const mondayIndex = (k) => (k === `${PREFIX}MONDAY_API_KEY` ? 0 : Number(k.slice(`${PREFIX}MONDAY_API_KEY_`.length)));

const env = {
  IN_HUB,
  PORT: read('PORT') || 3000,
  OPENAI_API_KEY: read('OPENAI_API_KEY'),
  MONDAY_API_KEY: read('MONDAY_API_KEY'),
  MONDAY_BOARD_ID: read('MONDAY_BOARD_ID'),
  // Recorded meetings can live under more than one Monday.com/Notetaker
  // account (e.g. a teammate's own Notetaker bot that isn't shared into the
  // primary account) — MONDAY_API_KEY_2, _3, etc. let the Notetaker fetch
  // pull from all of them and merge the results, so a recording that's
  // "missing" from one account's view still shows up. Task creation
  // (mondayService) intentionally keeps using MONDAY_API_KEY only.
  MONDAY_API_KEYS: Object.keys(process.env)
    .filter(k => MONDAY_KEY_RE.test(k))
    .sort((a, b) => mondayIndex(a) - mondayIndex(b))
    .map(k => process.env[k])
    .filter(Boolean),
  SLACK_BOT_TOKEN: read('SLACK_BOT_TOKEN'),
  SLACK_CHANNEL: read('SLACK_CHANNEL'),
  GOOGLE_CLIENT_ID: read('GOOGLE_CLIENT_ID'),
  GOOGLE_CLIENT_SECRET: read('GOOGLE_CLIENT_SECRET'),
  GOOGLE_REDIRECT_URI: read('GOOGLE_REDIRECT_URI'),
  // The login screen tells users sign-in is restricted to @zawadie.com — this
  // is what actually enforces that; without it, exchangeCodeForUser accepted
  // any Google account with a verified email, from any domain.
  GOOGLE_ALLOWED_DOMAIN: read('GOOGLE_ALLOWED_DOMAIN') || 'zawadie.com',
  SESSION_SECRET: read('SESSION_SECRET') || 'ombeni-dev-secret-change-me',
  // Standalone only: shared with the Zawadie Hub (hub-server/data/sso-secret.txt)
  // so this app can trust a sign-in that already happened there. Inside the hub
  // the signed-in user is handed over directly (req.hubUser) instead.
  SSO_SHARED_SECRET: process.env.ZAWADIE_SSO_SECRET || ''
};

env.isOpenAIConfigured = Boolean(env.OPENAI_API_KEY);
env.isMondayConfigured = Boolean(env.MONDAY_API_KEY && env.MONDAY_BOARD_ID);
env.isSlackConfigured = Boolean(env.SLACK_BOT_TOKEN && env.SLACK_CHANNEL);
env.isNotetakerConfigured = env.MONDAY_API_KEYS.length > 0;
env.isGoogleConfigured = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

module.exports = env;
