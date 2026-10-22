import { Link, useNavigate } from 'react-router-dom'
import { EXAM_QUESTIONS } from '../data/exam'
import { useProgress } from '../store/progress'
import { ExamRunner } from '../components/ExamRunner'
import { Button } from '../components/Button'

export function Exam() {
  const navigate = useNavigate()
  const { overallPct, recordExam, awardBadge } = useProgress()

  if (overallPct < 100) {
    return (
      <div className="mx-auto max-w-lg px-6 py-20 text-center">
        <p className="mb-4 text-text-soft">
          Finish every module before taking the final exam.
        </p>
        <Link to="/dashboard">
          <Button variant="secondary">Back to Dashboard</Button>
        </Link>
      </div>
    )
  }

  function handleFinish(score: number, passed: boolean) {
    recordExam(score, passed)
    if (passed) awardBadge('certified')
    navigate('/progress')
  }

  return (
    <div className="mx-auto max-w-2xl px-6 pb-24 pt-12 sm:px-12">
      <h1 className="mb-1.5 font-display text-3xl font-bold text-text">Final Exam</h1>
      <p className="mb-8 text-[15px] text-text-soft">
        Your exam score blends with your lesson average into your Total Score — 80% or higher
        there unlocks your Zawadie PromptClass certificate.
      </p>
      <ExamRunner questions={EXAM_QUESTIONS} onFinish={handleFinish} />
    </div>
  )
}
