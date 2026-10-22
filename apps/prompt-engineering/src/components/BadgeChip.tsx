import { Award, Lock } from 'lucide-react'
import type { BadgeDef } from '../data/badges'

export function BadgeChip({
  badge,
  locked = false,
}: {
  badge: BadgeDef
  locked?: boolean
}) {
  if (locked) {
    return (
      <span
        title={badge.description}
        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg px-3 py-1.5 text-xs font-semibold text-text-soft"
      >
        <Lock className="h-3.5 w-3.5" />
        {badge.name}
      </span>
    )
  }

  return (
    <span
      title={badge.description}
      className="inline-flex items-center gap-1.5 rounded-full border border-accent-soft bg-accent-soft px-3 py-1.5 text-xs font-semibold text-accent-hover"
    >
      <Award className="h-3.5 w-3.5" />
      {badge.name}
    </span>
  )
}
