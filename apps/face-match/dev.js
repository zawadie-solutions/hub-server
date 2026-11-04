// Runs Face Match on its own, on this computer only: no hub, no login, no database.
//
//   npm run face-match:dev          then open http://localhost:8100/
//
// For trying photos and settings before they go through the hub. It listens on 127.0.0.1 only, because
// there is no login here and the photos are biometric data. PORT overrides the port. The models
// download on first run (about 280 MB) unless ~/.insightface/models/buffalo_l already has them.
const express = require('express');
const { loadSettings } = require('./src/config');
const { EngineManager } = require('./src/manager');
const { createRouter } = require('./src/router');
const { createFileRequestLog } = require('./src/requestlog');

const settings = loadSettings();
const manager = new EngineManager({ settings });
manager.start(); // load the models now rather than on the first visit

const app = express();
app.set('strict routing', true); // as in the hub: without it '/face-match' and '/face-match/' are one route and redirect forever
app.get('/', (req, res) => res.redirect('/face-match/'));
// The page uses relative URLs, so it must be served from a path with a trailing slash (the hub does the same).
app.get('/face-match', (req, res) => res.redirect(301, '/face-match/'));
app.use('/face-match', createRouter({ manager, settings, requestLog: createFileRequestLog(settings.logPath) }));

const port = Number(process.env.PORT) || 8100;
app.listen(port, '127.0.0.1', () => {
  console.log(`Face Match is running at http://localhost:${port}/  (this computer only; Ctrl+C to stop)`);
  console.log(`Match line ${settings.matchThreshold}, possible line ${settings.possibleThreshold}, ${settings.intraOpThreads || 'auto'} threads`);
});
