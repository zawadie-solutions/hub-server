import { useEffect, useState } from 'react'
import { Trophy } from 'lucide-react'
import { Card } from '../components/Card'
import { useAuth } from '../store/auth'
import { api, type LeaderboardEntry } from '../lib/api'

export function Leaderboard() {
  const { user } = useAuth()
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .leaderboard()
      .then((res) => setEntries(res.entries))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'))
  }, [user])

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <div className="mb-8 text-center">
        <span className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1 text-xs font-semibold text-accent">
          <Trophy className="h-3.5 w-3.5" /> Leaderboard
        </span>
        <h1 className="font-display text-3xl font-bold text-heading">Top Scores</h1>
        <p className="mt-2 text-text-soft">
          {user
            ? 'Real scores from every signed-in learner.'
            : 'Real scores from every signed-in learner — sign in to save yours and appear here.'}
        </p>
      </div>

      <Card>
        {error && <p className="py-6 text-center text-sm text-danger">{error}</p>}

        {!error && entries === null && (
          <p className="py-6 text-center text-sm text-text-soft">Loading leaderboard…</p>
        )}

        {!error && entries !== null && entries.length === 0 && (
          <p className="py-6 text-center text-sm text-text-soft">
            No scores yet — be the first to sign in and earn points!
          </p>
        )}

        {!error && entries !== null && entries.length > 0 && (
          <div className="divide-y divide-border">
            {entries.map((row, i) => {
              const isYou = Boolean(user) && row.displayName === user?.displayName
              return (
                <div
                  key={`${row.displayName}-${i}`}
                  className={`flex items-center gap-4 py-3 ${
                    isYou ? 'rounded-xl bg-accent-soft px-3' : 'px-1'
                  }`}
                >
                  <span
                    className={`w-6 text-sm font-bold ${
                      i < 3 ? 'text-accent' : 'text-text-soft'
                    }`}
                  >
                    {i + 1}
                  </span>
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-bold text-white">
                    {row.displayName.charAt(0).toUpperCase()}
                  </span>
                  <span
                    className={`flex-1 text-sm font-semibold ${
                      isYou ? 'text-accent-hover' : 'text-heading'
                    }`}
                  >
                    {row.displayName}
                    {isYou && ' (you)'}
                  </span>
                  <span className="text-sm font-bold text-heading">{row.points} pts</span>
                </div>
              )
            })}
          </div>
        )}
      </Card>
    </div>
  )
}
