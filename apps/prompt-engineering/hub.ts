// Entry used by the Zawadie hub (hub-server/server.js): serves this app at /prompt-engineering —
// the same API functions Vercel runs (api/*), plus the built React app (dist/). The signed-in
// user is handed over by the hub as req.hubUser (see api/_lib/auth.ts). Its data stays in the
// Neon Postgres database named by PROMPT_ENGINEERING_DATABASE_URL.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import express from 'express'
import signout from './api/auth/signout'
import me from './api/auth/me'
import leaderboard from './api/leaderboard'
import progress from './api/progress'

type Handler = (req: VercelRequest, res: VercelResponse) => unknown

const routes: Record<string, Handler> = {
  '/api/auth/signout': signout,
  '/api/auth/me': me,
  '/api/leaderboard': leaderboard,
  '/api/progress': progress,
}

const DIST = fileURLToPath(new URL('./dist', import.meta.url))

export async function createSolution() {
  const app = express()

  // Express's req/res already have what these handlers use (method, headers, body; status, json).
  app.use('/api', express.json(), async (req, res) => {
    const handler = routes[`/api${req.path}`]
    if (!handler) return res.status(404).json({ error: 'Not found' })
    try {
      await handler(req as unknown as VercelRequest, res as unknown as VercelResponse)
    } catch (err) {
      console.error('[prompt-engineering]', err)
      if (!res.headersSent) res.status(500).json({ error: 'Internal server error' })
    }
  })

  // The built app's asset URLs already carry the /prompt-engineering/ prefix (vite `base`), so
  // inside this mount they arrive as /assets/..., /favicon.png, etc.
  app.use(express.static(DIST, { index: false }))
  // Client-side routes (BrowserRouter) all load the single page.
  app.get('*', (_req, res) => res.sendFile(path.join(DIST, 'index.html')))
  return app
}
