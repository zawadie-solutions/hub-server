import type { Module } from '../data/modules'

/** Max points for the response-comparison exercise: 2 pts/response (5) for a close rating, plus a 10pt bonus for picking the strongest response. */
export const COMPARISON_LESSON_MAX_POINTS = 20

export function lessonKey(moduleId: string, lessonId: string) {
  return `${moduleId}:${lessonId}`
}

export interface ModuleItem {
  id: string
  title: string
}

/** Every completable item in a module, in display order — lessons, then the response-comparison lesson if present. */
export function moduleItems(module: Module): ModuleItem[] {
  const items: ModuleItem[] = module.lessons.map((l) => ({ id: l.id, title: l.title }))
  if (module.comparisonLesson) {
    items.push({ id: module.comparisonLesson.id, title: module.comparisonLesson.title })
  }
  return items
}

export function isLessonComplete(
  completedLessons: Record<string, number>,
  moduleId: string,
  lessonId: string,
) {
  return lessonKey(moduleId, lessonId) in completedLessons
}

export function moduleDoneCount(module: Module, completedLessons: Record<string, number>) {
  return moduleItems(module).filter((item) => isLessonComplete(completedLessons, module.id, item.id))
    .length
}

export function isModuleComplete(module: Module, completedLessons: Record<string, number>) {
  const items = moduleItems(module)
  return items.length > 0 && moduleDoneCount(module, completedLessons) === items.length
}

export function isModuleUnlocked(
  modules: Module[],
  module: Module,
  completedLessons: Record<string, number>,
) {
  const sorted = [...modules].sort((a, b) => a.order - b.order)
  const idx = sorted.findIndex((m) => m.id === module.id)
  if (idx <= 0) return true
  return isModuleComplete(sorted[idx - 1], completedLessons)
}

export function modulePct(module: Module, completedLessons: Record<string, number>) {
  const items = moduleItems(module)
  if (items.length === 0) return 0
  return Math.round((moduleDoneCount(module, completedLessons) / items.length) * 100)
}

export function overallTotalCount(modules: Module[]) {
  return modules.reduce((sum, m) => sum + moduleItems(m).length, 0)
}

export function overallDoneCount(modules: Module[], completedLessons: Record<string, number>) {
  return modules.reduce((sum, m) => sum + moduleDoneCount(m, completedLessons), 0)
}

export function overallPct(modules: Module[], completedLessons: Record<string, number>) {
  const total = overallTotalCount(modules)
  if (total === 0) return 0
  return Math.round((overallDoneCount(modules, completedLessons) / total) * 100)
}

export function maxPointsForItem(module: Module, itemId: string): number {
  const lesson = module.lessons.find((l) => l.id === itemId)
  if (lesson) return lesson.challenge.criteria.reduce((sum, c) => sum + c.points, 0)
  if (module.comparisonLesson?.id === itemId) return COMPARISON_LESSON_MAX_POINTS
  return 0
}

/** Average % score across every completed lesson/exercise (not counting lessons not yet attempted). */
export function lessonAveragePct(modules: Module[], completedLessons: Record<string, number>) {
  let earned = 0
  let max = 0
  for (const module of modules) {
    for (const item of moduleItems(module)) {
      const key = lessonKey(module.id, item.id)
      if (key in completedLessons) {
        earned += completedLessons[key]
        max += maxPointsForItem(module, item.id)
      }
    }
  }
  if (max === 0) return 0
  return Math.round((earned / max) * 100)
}

/** First incomplete item in the module, or the last item if everything is done. */
export function nextItemId(module: Module, completedLessons: Record<string, number>) {
  const items = moduleItems(module)
  const next = items.find((item) => !isLessonComplete(completedLessons, module.id, item.id))
  return (next ?? items[items.length - 1])?.id ?? null
}
