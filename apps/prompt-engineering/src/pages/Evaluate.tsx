import { useState } from 'react'
import { evaluatePrompt } from '../lib/heuristics'
import { useProgress } from '../store/progress'
import { PromptScoreCard } from '../components/PromptScoreCard'
import { Button } from '../components/Button'

export function Evaluate() {
  const { awardBadge } = useProgress()
  const [text, setText] = useState('')
  const [scored, setScored] = useState(false)

  const evaluation = evaluatePrompt(text)

  function handleScore() {
    if (!text.trim()) return
    setScored(true)
    awardBadge('prompt-evaluator')
  }

  return (
    <div className="mx-auto max-w-2xl px-6 pb-24 pt-12 sm:px-12">
      <h1 className="mb-1.5 font-display text-3xl font-bold text-text">Prompt Evaluation</h1>
      <p className="mb-8 text-[15px] leading-relaxed text-text-soft">
        Paste or write a prompt below and get a score. This checks how the prompt is{' '}
        <em>constructed</em> — Role, Task, Context, Rules, and Output Format — not what an AI
        would actually output for it.
      </p>

      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setScored(false)
        }}
        placeholder="e.g. You are a business analyst. Summarize this report into five bullet points, identify risks, and recommend three actions."
        rows={7}
        className="mb-4 w-full resize-y rounded-control border border-border-input bg-surface p-4 font-mono text-sm text-text outline-none placeholder:text-text-softer"
      />

      <Button onClick={handleScore} disabled={!text.trim()}>
        Score my prompt
      </Button>

      {scored && (
        <div className="mt-6">
          <PromptScoreCard evaluation={evaluation} />
        </div>
      )}
    </div>
  )
}
