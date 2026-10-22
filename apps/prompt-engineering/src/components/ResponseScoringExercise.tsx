import { useState } from 'react'
import { CheckCircle2, Trophy } from 'lucide-react'
import type { ResponseComparisonLesson } from '../data/types'
import { Card } from './Card'
import { Button } from './Button'

interface Props {
  lesson: ResponseComparisonLesson
  onScored: (points: number) => void
}

function referenceAverage(scores: Record<string, number>) {
  const values = Object.values(scores)
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

export function ResponseScoringExercise({ lesson, onScored }: Props) {
  const [ratings, setRatings] = useState<Record<string, number>>({})
  const [submitted, setSubmitted] = useState(false)

  const allRated = lesson.responses.every((r) => ratings[r.id])
  const topPickId = lesson.responses.reduce((best, r) =>
    (ratings[r.id] ?? 0) > (ratings[best.id] ?? 0) ? r : best,
  ).id

  function handleSubmit() {
    setSubmitted(true)
    let points = 0
    for (const r of lesson.responses) {
      const reference = Math.round(referenceAverage(r.scores))
      const diff = Math.abs((ratings[r.id] ?? 0) - reference)
      if (diff <= 1) points += 2
    }
    if (topPickId === lesson.bestResponseId) points += 10
    onScored(points)
  }

  function handleRetry() {
    setRatings({})
    setSubmitted(false)
  }

  return (
    <Card>
      <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-warn">
        Exercise · Compare &amp; Score
      </div>
      <p className="mb-4 text-[14.5px] leading-relaxed text-text">
        Prompt shown to five different responses: <span className="italic">"{lesson.promptShown}"</span>
      </p>

      <div className="mb-4 grid grid-cols-1 gap-2 rounded-control bg-bg p-3 text-xs sm:grid-cols-2">
        {lesson.metrics.map((m) => (
          <div key={m.key}>
            <span className="font-bold text-text-soft">{m.label}: </span>
            <span className="text-text-soft">{m.description}</span>
          </div>
        ))}
      </div>

      <div className="space-y-4">
        {lesson.responses.map((r) => {
          const isBest = submitted && r.id === lesson.bestResponseId
          const reference = Math.round(referenceAverage(r.scores))
          return (
            <div
              key={r.id}
              className={`rounded-control border p-3.5 ${isBest ? 'border-success bg-success-soft' : 'border-border bg-surface'}`}
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-bold text-text">{r.label}</span>
                {isBest && (
                  <span className="flex items-center gap-1 text-xs font-bold text-success">
                    <Trophy className="h-3.5 w-3.5" /> Strongest response
                  </span>
                )}
              </div>
              <p className="mb-3 whitespace-pre-line font-mono text-[13px] leading-relaxed text-text">
                {r.text}
              </p>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-text-soft">Your score:</span>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    disabled={submitted}
                    onClick={() => setRatings((prev) => ({ ...prev, [r.id]: n }))}
                    className={`h-7 w-7 rounded-control text-xs font-bold transition-colors ${
                      ratings[r.id] === n
                        ? 'bg-accent text-white'
                        : 'border border-border-input bg-surface text-text-soft hover:border-accent'
                    } ${submitted ? 'cursor-default' : 'cursor-pointer'}`}
                  >
                    {n}
                  </button>
                ))}
                {submitted && (
                  <span className="ml-1 text-xs text-text-softer">
                    reference: {reference}/5
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {submitted && (
        <div className="mt-4 rounded-control bg-accent-soft p-4">
          <p className="mb-1 text-sm font-bold text-text">Why {lesson.bestResponseId === topPickId ? "you got it" : 'this one wins'}</p>
          <p className="text-sm text-text-soft">{lesson.explanation}</p>
        </div>
      )}

      <div className="mt-4 flex items-center gap-3">
        {!submitted ? (
          <Button onClick={handleSubmit} disabled={!allRated}>
            Submit scores
          </Button>
        ) : (
          <Button variant="secondary" onClick={handleRetry}>
            Try again
          </Button>
        )}
        {submitted && topPickId === lesson.bestResponseId && (
          <span className="flex items-center gap-1.5 text-sm font-bold text-success">
            <CheckCircle2 className="h-4 w-4" /> You picked the strongest response
          </span>
        )}
      </div>
    </Card>
  )
}
