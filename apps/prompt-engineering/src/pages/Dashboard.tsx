import { Link } from 'react-router-dom'
import { useAuth } from '../store/auth'
import { useProgress } from '../store/progress'
import { MODULES } from '../data/modules'
import { moduleDoneCount, modulePct, nextItemId } from '../lib/moduleProgress'
import { ModuleCard } from '../components/ModuleCard'
import { ProgressBar } from '../components/ProgressBar'

export function Dashboard() {
  const { user } = useAuth()
  const { completedLessons, overallPct, isModuleUnlocked, isModuleComplete } = useProgress()

  const firstName = user?.displayName.split(' ')[0] ?? 'there'
  const dashboardMessage =
    overallPct === 100
      ? "You've completed every module — head to the final exam to get certified."
      : Object.keys(completedLessons).length > 0
        ? 'Pick up right where you left off.'
        : 'Ready when you are — Module 1 is waiting.'

  return (
    <div className="mx-auto max-w-[1000px] px-6 pb-24 pt-12 sm:px-12">
      <h1 className="mb-1.5 font-display text-3xl font-bold text-text">
        Welcome back, {firstName}
      </h1>
      <p className="mb-7 text-[15px] text-text-soft">{dashboardMessage}</p>

      <div className="mb-9 flex items-center gap-5 rounded-card border border-border bg-surface px-6 py-5">
        <div className="flex-1">
          <div className="mb-2 flex justify-between text-[13px] text-text-soft">
            <span>Overall progress</span>
            <span>{overallPct}% complete</span>
          </div>
          <ProgressBar value={overallPct} />
        </div>
        <div className="font-display text-2xl font-bold text-success">{overallPct}%</div>
      </div>

      <div className="flex flex-col gap-3.5">
        {MODULES.map((m) => {
          const unlocked = isModuleUnlocked(m.id)
          const complete = isModuleComplete(m.id)
          const to = unlocked ? `/modules/${m.id}/lessons/${nextItemId(m, completedLessons)}` : '#'
          return (
            <ModuleCard
              key={m.id}
              to={to}
              order={m.order}
              title={m.title}
              blurb={m.blurb}
              pct={modulePct(m, completedLessons)}
              doneCount={moduleDoneCount(m, completedLessons)}
              unlocked={unlocked}
              complete={complete}
            />
          )
        })}
      </div>

      {overallPct === 100 && (
        <div className="mt-8 rounded-card border border-accent-soft bg-accent-soft p-6 text-center">
          <p className="mb-3 font-bold text-text">Every module is complete.</p>
          <Link
            to="/exam"
            className="inline-flex items-center justify-center rounded-control bg-accent px-6 py-3 text-sm font-bold text-white hover:bg-accent-hover"
          >
            Take the final exam
          </Link>
        </div>
      )}
    </div>
  )
}
