// Entry used by the Zawadie hub (hub-server/server.js): returns the Face Match router for the hub to
// mount at /face-match, behind the hub's login and per-solution access check. Settings come from
// config/facematch.json, with FACEMATCH_-prefixed overrides in the hub's .env (see config.js).
//
// The face models are loaded on first use, not at hub start (see manager.js).
const { loadSettings } = require('./config');
const { EngineManager } = require('./manager');
const { createRouter } = require('./router');
const { createFileRequestLog } = require('./requestlog');

async function createSolution() {
  const settings = loadSettings();
  const manager = new EngineManager({ settings });
  if (process.env.FACEMATCH_PRELOAD === '1') manager.start();
  return createRouter({ manager, settings, requestLog: createFileRequestLog(settings.logPath) });
}

module.exports = { createSolution };
