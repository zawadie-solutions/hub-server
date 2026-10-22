import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getSql } from './_lib/db.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const sql = getSql()
  const rows = await sql`
    SELECT u.display_name, p.points
    FROM progress p
    JOIN users u ON u.id = p.user_id
    ORDER BY p.points DESC, u.created_at ASC
    LIMIT 25
  `

  return res.status(200).json({
    entries: rows.map((r) => ({ displayName: r.display_name, points: r.points })),
  })
}
