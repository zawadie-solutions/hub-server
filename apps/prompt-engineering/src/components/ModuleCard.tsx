import { Link } from 'react-router-dom'
import { Lock } from 'lucide-react'
import { ProgressBar } from './ProgressBar'

interface Props {
  to: string
  order: number
  title: string
  blurb: string
  pct: number
  doneCount: number
  unlocked: boolean
  complete: boolean
}

export function ModuleCard({ to, order, title, blurb, pct, doneCount, unlocked, complete }: Props) {
  const statusLabel = !unlocked ? 'Locked' : complete ? 'Completed' : doneCount > 0 ? 'In progress' : 'Start'
  const statusColor = !unlocked
    ? 'text-text-softer'
    : complete
      ? 'text-success'
      : doneCount > 0
        ? 'text-accent'
        : 'text-text'

  const content = (
    <div
      className={`flex items-center gap-5 rounded-card border border-border bg-surface px-6 py-5 ${
        unlocked ? '' : 'opacity-50'
      }`}
    >
      <div className="w-8 shrink-0 font-display text-[22px] font-bold text-border-input">
        {order}
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1 text-[16px] font-bold text-text">{title}</div>
        <div className="mb-2.5 text-[13.5px] text-text-soft">{blurb}</div>
        <ProgressBar value={pct} className="w-full max-w-[220px]" />
      </div>
      <div className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[13px] font-bold ${statusColor}`}>
        {!unlocked && <Lock className="h-3.5 w-3.5" />}
        {statusLabel}
      </div>
    </div>
  )

  if (!unlocked) {
    return <div className="cursor-not-allowed">{content}</div>
  }
  return (
    <Link to={to} className="block">
      {content}
    </Link>
  )
}
