import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { ModuleId } from '../data/types'
import { MODULES } from '../data/modules'
import {
  isLessonComplete as checkLessonComplete,
  isModuleComplete as checkModuleComplete,
  isModuleUnlocked as checkModuleUnlocked,
  lessonAveragePct as computeLessonAveragePct,
  lessonKey,
  overallPct as computeOverallPct,
} from '../lib/moduleProgress'
import { rankForPoints } from '../lib/rank'
import { todayKey } from '../lib/date'
import { useAuth } from './auth'
import { api as backendApi, type RemoteProgress } from '../lib/api'

const STORAGE_KEY = 'pe-progress-v2'

interface ProgressState {
  points: number
  streak: number
  lastActiveDate: string | null
  completedLessons: Record<string, number>
  exam: { passed: boolean; score: number; attempted: boolean }
  badges: string[]
}

const emptyState: ProgressState = {
  points: 0,
  streak: 0,
  lastActiveDate: null,
  completedLessons: {},
  exam: { passed: false, score: 0, attempted: false },
  badges: [],
}

function loadState(): ProgressState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return emptyState
    return { ...emptyState, ...JSON.parse(raw) }
  } catch {
    return emptyState
  }
}

interface ProgressApi extends ProgressState {
  rankName: string
  overallPct: number
  lessonAveragePct: number
  totalScorePct: number
  certificateUnlocked: boolean
  isModuleUnlocked: (id: ModuleId) => boolean
  isModuleComplete: (id: ModuleId) => boolean
  isLessonComplete: (moduleId: ModuleId, lessonId: string) => boolean
  recordLesson: (moduleId: ModuleId, lessonId: string, points: number) => void
  recordExam: (score: number, passed: boolean) => void
  awardBadge: (badgeId: string) => void
  resetProgress: () => void
}

const ProgressContext = createContext<ProgressApi | null>(null)

function isEmptyRemote(p: RemoteProgress) {
  return (
    p.points === 0 &&
    p.streak === 0 &&
    p.lastActiveDate === null &&
    Object.keys(p.completedExercises).length === 0 &&
    !p.quizPassed.examAttempted &&
    p.badges.length === 0
  )
}

function toRemote(state: ProgressState): RemoteProgress {
  return {
    points: state.points,
    streak: state.streak,
    lastActiveDate: state.lastActiveDate,
    completedExercises: state.completedLessons,
    quizPassed: {
      examPassed: state.exam.passed,
      examScore: state.exam.score,
      examAttempted: state.exam.attempted,
    },
    badges: state.badges,
  }
}

function fromRemote(remote: RemoteProgress): ProgressState {
  return {
    points: remote.points,
    streak: remote.streak,
    lastActiveDate: remote.lastActiveDate,
    completedLessons: remote.completedExercises,
    exam: {
      passed: !!remote.quizPassed.examPassed,
      score: remote.quizPassed.examScore ?? 0,
      attempted: !!remote.quizPassed.examAttempted,
    },
    badges: remote.badges,
  }
}

export function ProgressProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [state, setState] = useState<ProgressState>(loadState)
  const stateRef = useRef(state)
  const hydratedForUserId = useRef<number | null>(null)

  useEffect(() => {
    stateRef.current = state
  }, [state])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }, [state])

  // On sign-in, adopt real progress from the database (cross-device
  // restore). If the account is brand new, push local progress up instead
  // of overwriting it with empty defaults.
  useEffect(() => {
    if (!user) {
      hydratedForUserId.current = null
      return
    }
    if (hydratedForUserId.current === user.id) return
    hydratedForUserId.current = user.id

    backendApi
      .me()
      .then((res) => {
        if (res.progress && !isEmptyRemote(res.progress)) {
          setState(fromRemote(res.progress))
        } else {
          backendApi.saveProgress(toRemote(stateRef.current)).catch(() => {})
        }
      })
      .catch(() => {})
  }, [user])

  // Push local changes up to the database whenever signed in.
  useEffect(() => {
    if (!user) return
    const timer = setTimeout(() => {
      backendApi.saveProgress(toRemote(state)).catch(() => {})
    }, 600)
    return () => clearTimeout(timer)
  }, [user, state])

  useEffect(() => {
    const today = todayKey()
    setState((prev) => {
      if (prev.lastActiveDate === today) return prev
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
      const nextStreak = prev.lastActiveDate === yesterday ? prev.streak + 1 : 1
      return { ...prev, streak: nextStreak, lastActiveDate: today }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const api = useMemo<ProgressApi>(() => {
    const isModuleComplete = (id: ModuleId) => {
      const module = MODULES.find((m) => m.id === id)
      return !!module && checkModuleComplete(module, state.completedLessons)
    }

    const isModuleUnlocked = (id: ModuleId) => {
      const module = MODULES.find((m) => m.id === id)
      return !!module && checkModuleUnlocked(MODULES, module, state.completedLessons)
    }

    const isLessonComplete = (moduleId: ModuleId, lessonId: string) =>
      checkLessonComplete(state.completedLessons, moduleId, lessonId)

    const recordLesson = (moduleId: ModuleId, lessonId: string, points: number) => {
      setState((prev) => {
        const key = lessonKey(moduleId, lessonId)
        const already = prev.completedLessons[key] ?? 0
        if (key in prev.completedLessons && points <= already) return prev
        return {
          ...prev,
          points: prev.points - already + points,
          completedLessons: { ...prev.completedLessons, [key]: points },
        }
      })
    }

    const recordExam = (score: number, passed: boolean) => {
      setState((prev) => {
        const already = prev.exam.score
        const nextPoints = score > already ? prev.points - already + score : prev.points
        return {
          ...prev,
          points: nextPoints,
          exam: { passed: passed || prev.exam.passed, score: Math.max(already, score), attempted: true },
        }
      })
    }

    const awardBadge = (badgeId: string) => {
      setState((prev) =>
        prev.badges.includes(badgeId) ? prev : { ...prev, badges: [...prev.badges, badgeId] },
      )
    }

    const resetProgress = () => setState(emptyState)

    const overallPct = computeOverallPct(MODULES, state.completedLessons)
    const lessonAvg = computeLessonAveragePct(MODULES, state.completedLessons)
    const totalScorePct = state.exam.attempted
      ? Math.round((lessonAvg + state.exam.score) / 2)
      : lessonAvg

    return {
      ...state,
      rankName: rankForPoints(state.points).name,
      overallPct,
      lessonAveragePct: lessonAvg,
      totalScorePct,
      certificateUnlocked: overallPct === 100 && totalScorePct >= 80,
      isModuleUnlocked,
      isModuleComplete,
      isLessonComplete,
      recordLesson,
      recordExam,
      awardBadge,
      resetProgress,
    }
  }, [state])

  return <ProgressContext.Provider value={api}>{children}</ProgressContext.Provider>
}

export function useProgress() {
  const ctx = useContext(ProgressContext)
  if (!ctx) throw new Error('useProgress must be used within ProgressProvider')
  return ctx
}
