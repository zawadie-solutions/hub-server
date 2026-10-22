import { useState } from 'react'
import { CheckCircle2, PartyPopper, XCircle } from 'lucide-react'
import type { QuizQuestion } from '../data/types'
import { Card } from './Card'
import { Button } from './Button'

const PASS_THRESHOLD = 0.8

interface Props {
  questions: QuizQuestion[]
  onFinish: (score: number, passed: boolean) => void
}

export function ExamRunner({ questions, onFinish }: Props) {
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [submitted, setSubmitted] = useState(false)

  const correctCount = questions.filter((q) => answers[q.id] === q.correctId).length
  const score = Math.round((correctCount / questions.length) * 100)
  const passed = score >= PASS_THRESHOLD * 100
  const allAnswered = questions.every((q) => answers[q.id])

  function handleSubmit() {
    setSubmitted(true)
    onFinish(score, passed)
  }

  function handleRetry() {
    setAnswers({})
    setSubmitted(false)
  }

  return (
    <Card>
      <div className="mb-5 flex items-center justify-between">
        <h2 className="font-display text-xl font-bold text-text">Final Exam</h2>
        <span className="text-xs font-medium text-text-soft">Need 80% to pass ({Math.ceil(questions.length * PASS_THRESHOLD)}/{questions.length})</span>
      </div>

      <div className="space-y-6">
        {questions.map((q, qi) => (
          <div key={q.id}>
            <p className="mb-2.5 text-sm font-bold text-text">
              {qi + 1}. {q.question}
            </p>
            <div className="space-y-2">
              {q.options.map((opt) => {
                const isSelected = answers[q.id] === opt.id
                const showCorrect = submitted && opt.id === q.correctId
                const showWrong = submitted && isSelected && opt.id !== q.correctId
                return (
                  <button
                    key={opt.id}
                    type="button"
                    disabled={submitted}
                    onClick={() => setAnswers((a) => ({ ...a, [q.id]: opt.id }))}
                    className={`flex w-full items-center gap-2 rounded-control border px-4 py-2.5 text-left text-sm transition-colors ${
                      showCorrect
                        ? 'border-success bg-success-soft text-text'
                        : showWrong
                          ? 'border-danger bg-danger-soft text-text'
                          : isSelected
                            ? 'border-accent bg-accent-soft text-text'
                            : 'border-border-input bg-surface hover:border-accent'
                    } ${submitted ? 'cursor-default' : 'cursor-pointer'}`}
                  >
                    {showCorrect && <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />}
                    {showWrong && <XCircle className="h-4 w-4 shrink-0 text-danger" />}
                    <span>{opt.text}</span>
                  </button>
                )
              })}
            </div>
            {submitted && (
              <p className="mt-2 rounded-control bg-bg p-2.5 text-xs text-text-soft">
                {q.explanation}
              </p>
            )}
          </div>
        ))}
      </div>

      {submitted && (
        <div
          className={`mt-6 flex items-center gap-2 rounded-control p-3.5 text-sm font-bold ${
            passed ? 'bg-success-soft text-success' : 'bg-warn-soft text-warn'
          }`}
        >
          {passed ? <PartyPopper className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
          {passed
            ? `You scored ${score}% — certificate unlocked!`
            : `You scored ${score}%. You need 80% to pass — try again.`}
        </div>
      )}

      <div className="mt-5">
        {!submitted ? (
          <Button onClick={handleSubmit} disabled={!allAnswered}>
            Submit exam
          </Button>
        ) : !passed ? (
          <Button variant="secondary" onClick={handleRetry}>
            Retake exam
          </Button>
        ) : null}
      </div>
    </Card>
  )
}
