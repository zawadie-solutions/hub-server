import { CheckCircle2, Circle } from 'lucide-react'
import type { PromptEvaluation } from '../lib/heuristics'
import { Card } from './Card'

const bandColor: Record<PromptEvaluation['band'], string> = {
  'Needs work': 'text-danger',
  Developing: 'text-warn',
  Strong: 'text-success',
  Excellent: 'text-success',
}

export function PromptScoreCard({ evaluation }: { evaluation: PromptEvaluation }) {
  return (
    <Card>
      <div className="mb-5 flex items-center gap-6">
        <div
          className="flex h-24 w-24 shrink-0 items-center justify-center rounded-full"
          style={{
            background: `conic-gradient(#1DB881 ${evaluation.score}%, #F1F5F9 0)`,
          }}
        >
          <div className="flex h-[76px] w-[76px] items-center justify-center rounded-full bg-surface font-display text-lg font-bold text-text">
            {evaluation.score}%
          </div>
        </div>
        <div>
          <div className={`font-display text-xl font-bold ${bandColor[evaluation.band]}`}>
            {evaluation.band}
          </div>
          <p className="text-sm text-text-soft">
            Scored against the RTCRO framework — Role, Task, Context, Rules, Output Format.
          </p>
        </div>
      </div>

      <ul className="space-y-3">
        {evaluation.dimensions.map((d) => (
          <li key={d.key} className="rounded-control bg-bg p-3.5">
            <div className="flex items-start gap-2.5">
              {d.met ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
              ) : (
                <Circle className="mt-0.5 h-4 w-4 shrink-0 text-text-softer" />
              )}
              <div>
                <div className={`text-sm font-bold ${d.met ? 'text-text' : 'text-text-soft'}`}>
                  {d.label}
                </div>
                {!d.met && <div className="mt-1 text-xs text-text-softer">{d.tip}</div>}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  )
}
