import type { VercelRequest, VercelResponse } from '@vercel/node'
import { destroySession, clearSessionCookie } from '../_lib/auth.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  await destroySession(req)
  clearSessionCookie(res)

  return res.status(200).json({ ok: true })
}
