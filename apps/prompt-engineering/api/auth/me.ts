import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getSql } from '../_lib/db.js'
import { getUserFromRequest } from '../_lib/auth.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const user = await getUserFromRequest(req)
  if (!user) return res.status(200).json({ user: null, progress: null })

  const sql = getSql()
  const rows = await sql`
    SELECT points, streak, last_active_date::text AS last_active_date, completed_exercises, quiz_passed, badges
    FROM progress WHERE user_id = ${user.id}
  `
  const progress = rows[0]

  return res.status(200).json({
    user: { id: user.id, email: user.email, displayName: user.display_name },
    progress: progress && {
      points: progress.points,
      streak: progress.streak,
      lastActiveDate: progress.last_active_date,
      completedExercises: progress.completed_exercises,
      quizPassed: progress.quiz_passed,
      badges: progress.badges,
    },
  })
}
