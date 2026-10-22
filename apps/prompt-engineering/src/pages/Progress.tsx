import { Link } from 'react-router-dom'
import { useAuth } from '../store/auth'
import { useProgress } from '../store/progress'
import { MODULES } from '../data/modules'
import { moduleDoneCount, modulePct, overallDoneCount, overallTotalCount } from '../lib/moduleProgress'
import { ProgressBar } from '../components/ProgressBar'
import { CertificateCard } from '../components/CertificateCard'
import { Button } from '../components/Button'

export function Progress() {
  const { user } = useAuth()
  const { completedLessons, overallPct, totalScorePct, lessonAveragePct, certificateUnlocked, exam } =
    useProgress()

  const doneLessons = overallDoneCount(MODULES, completedLessons)
  const totalLessons = overallTotalCount(MODULES)
  const name = user?.displayName ?? 'Guest Learner'

  return (
    <div className="mx-auto max-w-[900px] px-6 pb-24 pt-12 sm:px-12">
      <h1 className="mb-1.5 font-display text-3xl font-bold text-text">Your progress</h1>
      <p className="mb-8 text-[15px] text-text-soft">
        Finish every module with an average score of 80% or higher to unlock your certificate.
      </p>

      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex items-center gap-7 rounded-card border border-border bg-surface p-7">
          <div
            className="flex h-[100px] w-[100px] shrink-0 items-center justify-center rounded-full"
            style={{ background: `conic-gradient(#1DB881 ${overallPct}%, #F1F5F9 0)` }}
          >
            <div className="flex h-[76px] w-[76px] items-center justify-center rounded-full bg-surface font-display text-[19px] font-bold text-text">
              {overallPct}%
            </div>
          </div>
          <div className="flex-1">
            <div className="mb-1 text-[16px] font-bold text-text">
              {doneLessons} of {totalLessons} lessons complete
            </div>
            <div className="text-[13.5px] text-text-soft">
              {overallPct === 100
                ? 'Every module is done.'
                : 'Keep going — finish every module to unlock your certificate.'}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-7 rounded-card border border-border bg-surface p-7">
          <div
            className="flex h-[100px] w-[100px] shrink-0 items-center justify-center rounded-full"
            style={{
              background: `conic-gradient(${totalScorePct >= 80 ? '#1DB881' : '#EBB019'} ${totalScorePct}%, #F1F5F9 0)`,
            }}
          >
            <div className="flex h-[76px] w-[76px] items-center justify-center rounded-full bg-surface font-display text-[19px] font-bold text-text">
              {totalScorePct}%
            </div>
          </div>
          <div className="flex-1">
            <div className="mb-1 text-[16px] font-bold text-text">Total Score</div>
            <div className="text-[13.5px] text-text-soft">
              Lesson average: {lessonAveragePct}%
              {exam.attempted && <> · Exam: {exam.score}%</>}
              <br />
              Needs 80%+ to qualify for a certificate.
            </div>
          </div>
        </div>
      </div>

      <div className="mb-8 flex flex-col gap-3">
        {MODULES.map((m) => (
          <div
            key={m.id}
            className="flex items-center gap-4 rounded-card border border-border bg-surface px-5 py-4"
          >
            <div className="w-[200px] shrink-0 truncate text-[13.5px] font-bold text-text">
              {m.title}
            </div>
            <ProgressBar value={modulePct(m, completedLessons)} className="flex-1" />
            <div className="w-[60px] shrink-0 text-right text-[12.5px] text-text-softer">
              {moduleDoneCount(m, completedLessons)}/{m.lessons.length + (m.comparisonLesson ? 1 : 0)}
            </div>
          </div>
        ))}
      </div>

      {overallPct === 100 && !certificateUnlocked && (
        <div className="mb-8 rounded-card border border-accent-soft bg-accent-soft p-6 text-center">
          <p className="mb-3 font-bold text-text">
            {totalScorePct > 0 && totalScorePct < 80
              ? `Your total score is ${totalScorePct}%. You need 80% to qualify for a certificate.`
              : "You've finished every module — take the final exam to boost your score and get certified."}
          </p>
          <Link to="/exam">
            <Button>{exam.attempted ? 'Retake the exam' : 'Take the final exam'}</Button>
          </Link>
        </div>
      )}

      {certificateUnlocked && <CertificateCard name={name} score={totalScorePct} />}
    </div>
  )
}
