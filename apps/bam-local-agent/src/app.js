import 'dotenv/config';
import express from 'express';
import OpenAI from 'openai';
import { pathToFileURL } from 'node:url';
import apiRouter, { pageRouter } from './routes/api.js';
import { ensureTables } from './config/ensureTables.js';
import { ensureSchema } from './config/migrate.js';

const app = express();
app.set('trust proxy', 1); // Hostinger sits behind a proxy; needed for per-IP rate limits

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/api', apiRouter);
app.use(pageRouter); // admin portal: / and /admin

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  // An OpenAI failure must never reach the pages as its own status: OpenAI's 401 (bad server key) would read as
  // "your access code is wrong" and sign the person out. Report it as an upstream problem with a message they can act on.
  if (err instanceof OpenAI.APIError) {
    const error = err.status === 401
      ? 'The AI service rejected the server\'s OpenAI key. An admin needs to update BAM_OPENAI_API_KEY (or OPENAI_API_KEY) and restart the app.'
      : err.status === 429
        ? 'The AI service is busy or out of credit right now. Please try again in a few minutes.'
        : 'The AI service could not be reached. Please try again.';
    return res.status(502).json({ error });
  }
  res.status(err.status || 500).json({ error: 'Internal server error' });
});

await ensureTables();    // creates stores/playbooks/knowledge_chunks on a fresh database (no-op once they exist)
await ensureSchema();   // adds the auto-research columns / knowledge types to an existing database

// Only listen on our own port when run standalone (`npm start` in this folder).
// When the Zawadie hub imports this module instead (see ../hub.js), it mounts
// `app` itself and must own the listening socket.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = process.env.PORT || 3000;
  const server = app.listen(port, () => console.log(`BAM Local Agent listening on port ${port}`));
  server.setTimeout(110_000); // stay under Hostinger's 120s request limit
}

process.on('unhandledRejection', (err) => console.error('Unhandled rejection:', err));

export default app;
