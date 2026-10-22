interface Props {
  before: string
  after: string
}

export function BeforeAfterPanel({ before, after }: Props) {
  return (
    <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div className="rounded-card border border-danger/25 bg-surface p-4">
        <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-danger">
          Before
        </div>
        <div className="font-mono text-[13.5px] leading-relaxed text-text">{before}</div>
      </div>
      <div className="rounded-card border border-success/25 bg-surface p-4">
        <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-success">
          After
        </div>
        <div className="font-mono text-[13.5px] leading-relaxed text-text">{after}</div>
      </div>
    </div>
  )
}
