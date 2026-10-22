export function ProgressBar({
  value,
  className = '',
}: {
  value: number
  className?: string
}) {
  const pct = Math.max(0, Math.min(100, value))
  return (
    <div
      className={`h-2 w-full overflow-hidden rounded-pill bg-track ${className}`}
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full rounded-pill bg-success transition-all duration-500 ease-out"
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}
