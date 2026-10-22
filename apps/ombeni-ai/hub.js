// Entry used by the Zawadie hub (hub-server/server.js): returns this app for the hub to mount at
// /ombeni-ai. Settings come from the hub's .env with an OMBENI_ prefix (see config/env.js), and
// the signed-in user is handed over by the hub as req.hubUser (see services/hubTrust.js).
async function createSolution() {
  process.env.OMBENI_IN_HUB = '1';
  return require('./server.js');
}

module.exports = { createSolution };
