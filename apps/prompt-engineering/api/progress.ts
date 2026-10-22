import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getSql } from './_lib/db.js'
import { getUserFromRequest } from './_lib/auth.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const user = await getUserFromRequest(req)
  if (!user) return res.status(401).json({ error: 'Not signed in' })

  const sql = getSql()

  if (req.method === 'GET') {
    const rows = await sql`
      SELECT points, streak, last_active_date::text AS last_active_date, completed_exercises, quiz_passed, badges
      FROM progress WHERE user_id = ${user.id}
    `
    const progress = rows[0]
    return res.status(200).json({
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

  if (req.method === 'PUT') {
    const body = req.body ?? {}
    const points = Number.isFinite(body.points) ? Math.trunc(body.points) : 0
    const streak = Number.isFinite(body.streak) ? Math.trunc(body.streak) : 0
    const lastActiveDate = typeof body.lastActiveDate === 'string' ? body.lastActiveDate : null
    const completedExercises =
      body.completedExercises && typeof body.completedExercises === 'object'
        ? body.completedExercises
        : {}
    const quizPassed =
      body.quizPassed && typeof body.quizPassed === 'object' ? body.quizPassed : {}
    const badges = Array.isArray(body.badges) ? body.badges : []

    await sql`
      INSERT INTO progress (user_id, points, streak, last_active_date, completed_exercises, quiz_passed, badges, updated_at)
      VALUES (${user.id}, ${points}, ${streak}, ${lastActiveDate}, ${JSON.stringify(completedExercises)}, ${JSON.stringify(quizPassed)}, ${JSON.stringify(badges)}, now())
      ON CONFLICT (user_id) DO UPDATE SET
        points = EXCLUDED.points,
        streak = EXCLUDED.streak,
        last_active_date = EXCLUDED.last_active_date,
        completed_exercises = EXCLUDED.completed_exercises,
        quiz_passed = EXCLUDED.quiz_passed,
        badges = EXCLUDED.badges,
        updated_at = now()
    `
    return res.status(200).json({ ok: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
