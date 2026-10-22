import { useState } from 'react'
import { CheckCircle2, Circle, Lightbulb } from 'lucide-react'
import type { Challenge, RtcroFramework } from '../data/types'
import { scoreText } from '../lib/heuristics'
import { Card } from './Card'
import { Button } from './Button'

interface Props {
  challenge: Challenge
  framework?: RtcroFramework
  onScored: (points: number) => void
}

export function ChallengeCard({ challenge, framework, onScored }: Props) {
  const [draft, setDraft] = useState('')
  const [output, setOutput] = useState<string | null>(null)
  const [checked, setChecked] = useState(false)
  const [showModel, setShowModel] = useState(false)

  const result = scoreText(draft, challenge.criteria)
  const fullMarks = checked && result.score === result.max

  function handleTest() {
    setOutput(draft.trim() ? challenge.sampleOutput : 'Write a prompt above, then click Test to see a sample response.')
  }

  function handleScore() {
    if (!draft.trim()) return
    setChecked(true)
    onScored(result.score)
  }

  function handleRetry() {
    setChecked(false)
    setOutput(null)
  }

  return (
    <Card>
      <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-warn">
        Challenge
      </div>
      <p className="mb-4 text-[14.5px] leading-relaxed text-text">{challenge.prompt}</p>

      {framework && (
        <dl className="mb-4 grid grid-cols-1 gap-x-4 gap-y-1.5 rounded-control bg-bg p-3 text-xs sm:grid-cols-2">
          {(
            [
              ['Role', framework.role],
              ['Task', framework.task],
              ['Context', framework.context],
              ['Rules', framework.rules],
              ['Output Format', framework.outputFormat],
            ] as const
          ).map(([label, value]) => (
            <div key={label}>
              <dt className="font-bold text-text-soft">{label}</dt>
              <dd className="text-text-soft">{value}</dd>
            </div>
          ))}
        </dl>
      )}

      <textarea
        value={draft}
        disabled={checked}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={challenge.placeholder}
        rows={4}
        className="w-full resize-y rounded-control border border-border-input bg-surface p-3.5 font-mono text-sm text-text outline-none placeholder:text-text-softer disabled:bg-bg"
      />

      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={handleTest}>
          Test my prompt
        </Button>
        {!checked ? (
          <Button onClick={handleScore} disabled={!draft.trim()}>
            Score my prompt
          </Button>
        ) : (
          <Button variant="secondary" onClick={handleRetry}>
            Try again
          </Button>
        )}
      </div>

      {output && (
        <div className="mt-4 rounded-control bg-bg p-4">
          <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-text-softer">
            Sample response
          </div>
          <p className="text-[13.5px] leading-relaxed text-text">{output}</p>
        </div>
      )}

      {checked && (
        <div className="mt-4 space-y-3">
          <div className="rounded-control bg-bg p-4">
            <p className="mb-2 text-sm font-bold text-text">
              You scored {result.score} / {result.max} points
            </p>
            <ul className="space-y-1.5">
              {result.hits.map((hit) => (
                <li key={hit.label} className="flex items-start gap-2 text-sm">
                  {hit.met ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                  ) : (
                    <Circle className="mt-0.5 h-4 w-4 shrink-0 text-text-softer" />
                  )}
                  <span className={hit.met ? 'text-text' : 'text-text-soft'}>{hit.label}</span>
                </li>
              ))}
            </ul>
          </div>

          {!showModel ? (
            <button
              type="button"
              onClick={() => setShowModel(true)}
              className="flex items-center gap-1.5 text-sm font-bold text-accent hover:text-accent-hover"
            >
              <Lightbulb className="h-4 w-4" /> Reveal model answer
            </button>
          ) : (
            <div className="rounded-control border border-success/25 bg-success-soft p-4">
              <p className="mb-1 text-sm font-bold text-text">Model answer</p>
              <p className="mb-2 font-mono text-[13.5px] italic text-text">
                "{challenge.modelAnswer}"
              </p>
              <p className="text-sm text-text-soft">{challenge.modelAnswerNote}</p>
            </div>
          )}

          {fullMarks && (
            <span className="flex items-center gap-1.5 text-sm font-bold text-success">
              <CheckCircle2 className="h-4 w-4" /> Full marks
            </span>
          )}
        </div>
      )}
    </Card>
  )
}
