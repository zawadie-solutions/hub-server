import { useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { Lock } from 'lucide-react'
import { MODULES, getModule } from '../data/modules'
import { moduleItems, lessonKey, nextItemId } from '../lib/moduleProgress'
import { useProgress } from '../store/progress'
import { LessonSidebar } from '../components/LessonSidebar'
import { BeforeAfterPanel } from '../components/BeforeAfterPanel'
import { ChallengeCard } from '../components/ChallengeCard'
import { ResponseScoringExercise } from '../components/ResponseScoringExercise'
import { Button } from '../components/Button'

export function Lesson() {
  const { moduleId = '', lessonId = '' } = useParams()
  const navigate = useNavigate()
  const { completedLessons, isModuleUnlocked, isLessonComplete, recordLesson, awardBadge } =
    useProgress()
  const [attempted, setAttempted] = useState(false)

  const module = getModule(moduleId)

  if (!module) {
    return (
      <div className="mx-auto max-w-lg px-6 py-20 text-center">
        <p className="text-text-soft">Module not found.</p>
        <Link to="/dashboard" className="font-bold text-accent">
          Back to Dashboard
        </Link>
      </div>
    )
  }

  if (!isModuleUnlocked(module.id)) {
    return (
      <div className="mx-auto max-w-lg px-6 py-20 text-center">
        <Lock className="mx-auto mb-3 h-8 w-8 text-text-softer" />
        <p className="mb-4 text-text-soft">
          Complete the previous module first to unlock {module.title}.
        </p>
        <Link to="/dashboard">
          <Button variant="secondary">Back to Dashboard</Button>
        </Link>
      </div>
    )
  }

  const items = moduleItems(module)
  const itemIdx = items.findIndex((i) => i.id === lessonId)
  const lesson = module.lessons.find((l) => l.id === lessonId)
  const isComparison = module.comparisonLesson?.id === lessonId

  if (itemIdx === -1 || (!lesson && !isComparison)) {
    return (
      <div className="mx-auto max-w-lg px-6 py-20 text-center">
        <p className="text-text-soft">Lesson not found.</p>
      </div>
    )
  }

  const modIdx = MODULES.findIndex((m) => m.id === module.id)
  const isLastItemInModule = itemIdx === items.length - 1
  const isLastModule = modIdx === MODULES.length - 1
  const isLastOverall = isLastItemInModule && isLastModule

  const alreadyComplete = isLessonComplete(module.id, lessonId)
  const canContinue = alreadyComplete || attempted

  function goNext() {
    if (!isLastItemInModule) {
      navigate(`/modules/${module!.id}/lessons/${items[itemIdx + 1].id}`)
      return
    }
    if (!isLastModule) {
      const next = MODULES[modIdx + 1]
      navigate(`/modules/${next.id}/lessons/${nextItemId(next, completedLessons)}`)
      return
    }
    navigate('/progress')
  }

  function handleScored(points: number, maxPoints?: number) {
    recordLesson(module!.id, lessonId, points)
    setAttempted(true)

    const pending = { ...completedLessons, [lessonKey(module!.id, lessonId)]: points }
    const nowComplete = items.every((item) => lessonKey(module!.id, item.id) in pending)
    if (nowComplete) awardBadge(`${module!.id}-graduate`)

    if (lessonId === 'rtcro-framework' && maxPoints && points >= maxPoints) {
      awardBadge('rtcro-master')
    }
    if (isComparison && points >= 15) {
      awardBadge('response-scorer')
    }
  }

  return (
    <div className="mx-auto flex max-w-[1160px] flex-col gap-8 px-6 py-10 sm:px-12 md:flex-row">
      <LessonSidebar
        moduleId={module.id}
        moduleOrder={module.order}
        moduleTitle={module.title}
        items={items}
        activeItemId={lessonId}
        isItemComplete={(id) => isLessonComplete(module.id, id)}
      />

      <div className="min-w-0 flex-1">
        <div className="mb-1.5 text-[13px] text-text-softer">
          Module {module.order} · Lesson {itemIdx + 1} of {items.length}
        </div>

        {lesson && (
          <>
            <h1 className="mb-5 font-display text-[28px] font-bold text-text">{lesson.title}</h1>
            {lesson.teach.map((p, i) => (
              <p key={i} className="mb-4 text-[15.5px] leading-relaxed text-text">
                {p}
              </p>
            ))}
            <div className="mb-8" />
            <BeforeAfterPanel before={lesson.before} after={lesson.after} />
            <ChallengeCard
              challenge={lesson.challenge}
              framework={lesson.framework}
              onScored={(points) =>
                handleScored(
                  points,
                  lesson.challenge.criteria.reduce((s, c) => s + c.points, 0),
                )
              }
            />
          </>
        )}

        {isComparison && module.comparisonLesson && (
          <>
            <h1 className="mb-5 font-display text-[28px] font-bold text-text">
              {module.comparisonLesson.title}
            </h1>
            {module.comparisonLesson.teach.map((p, i) => (
              <p key={i} className="mb-4 text-[15.5px] leading-relaxed text-text">
                {p}
              </p>
            ))}
            <div className="mb-4" />
            <ResponseScoringExercise
              lesson={module.comparisonLesson}
              onScored={(points) => handleScored(points)}
            />
          </>
        )}

        <div className="mt-8">
          <Button onClick={goNext} disabled={!canContinue}>
            {isLastOverall ? 'Finish course' : 'Mark complete & continue'}
          </Button>
        </div>
      </div>
    </div>
  )
}
