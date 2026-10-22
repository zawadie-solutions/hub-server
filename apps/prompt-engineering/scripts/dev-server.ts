import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import signout from '../api/auth/signout'
import me from '../api/auth/me'
import leaderboard from '../api/leaderboard'
import progress from '../api/progress'

type Handler = (req: VercelRequest, res: VercelResponse) => unknown

const routes: Record<string, Handler> = {
  '/api/auth/signout': signout,
  '/api/auth/me': me,
  '/api/leaderboard': leaderboard,
  '/api/progress': progress,
}

const PORT = process.env.PORT ? Number(process.env.PORT) : 3001

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw) return undefined
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

function toVercelResponse(res: ServerResponse): VercelResponse {
  const vRes = res as unknown as VercelResponse
  ;(vRes as unknown as { status: VercelResponse['status'] }).status = (code: number) => {
    res.statusCode = code
    return vRes
  }
  ;(vRes as unknown as { json: VercelResponse['json'] }).json = (data: unknown) => {
    if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(data))
    return vRes
  }
  return vRes
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const handler = routes[url.pathname]
  if (!handler) {
    res.statusCode = 404
    res.end('Not found')
    return
  }

  const body =
    req.method && !['GET', 'HEAD'].includes(req.method) ? await readJsonBody(req) : undefined
  const vReq = req as unknown as VercelRequest
  ;(vReq as unknown as { body: unknown }).body = body

  try {
    await handler(vReq, toVercelResponse(res))
  } catch (err) {
    console.error(err)
    if (!res.headersSent) {
      res.statusCode = 500
      res.end(JSON.stringify({ error: 'Internal server error' }))
    }
  }
})

server.listen(PORT, () => {
  console.log(`API dev server listening on http://localhost:${PORT}`)
})
