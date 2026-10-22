import { Link } from 'react-router-dom'
import type { ModuleItem } from '../lib/moduleProgress'

interface Props {
  moduleId: string
  moduleOrder: number
  moduleTitle: string
  items: ModuleItem[]
  activeItemId: string
  isItemComplete: (id: string) => boolean
}

export function LessonSidebar({
  moduleId,
  moduleOrder,
  moduleTitle,
  items,
  activeItemId,
  isItemComplete,
}: Props) {
  return (
    <div className="w-full shrink-0 md:w-56">
      <div className="mb-3 text-xs font-bold uppercase tracking-wide text-text-softer">
        Module {moduleOrder} · {moduleTitle}
      </div>
      <div className="flex flex-col gap-1">
        {items.map((item) => {
          const isCurrent = item.id === activeItemId
          const done = isItemComplete(item.id)
          return (
            <Link
              key={item.id}
              to={`/modules/${moduleId}/lessons/${item.id}`}
              className={`flex items-center gap-2.5 rounded-control px-3 py-2.5 text-sm transition-colors ${
                isCurrent ? 'bg-accent-soft' : 'hover:bg-track/60'
              }`}
            >
              <span
                className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                  done
                    ? 'bg-success text-white'
                    : isCurrent
                      ? 'bg-accent text-white'
                      : 'bg-track text-text-softer'
                }`}
              >
                {done ? '✓' : items.indexOf(item) + 1}
              </span>
              <span
                className={`${isCurrent ? 'font-bold text-text' : 'text-text-soft'}`}
              >
                {item.title}
              </span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
