import 'dotenv/config';
import express from 'express';
import apiRouter, { pageRouter } from './routes/api.js';
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
  res.status(err.status || 500).json({ error: 'Internal server error' });
});

await ensureSchema();   // adds the auto-research columns / knowledge types to an existing database

const port = process.env.PORT || 3000;
const server = app.listen(port, () => console.log(`BAM Local Agent listening on port ${port}`));
server.setTimeout(110_000); // stay under Hostinger's 120s request limit

process.on('unhandledRejection', (err) => console.error('Unhandled rejection:', err));
