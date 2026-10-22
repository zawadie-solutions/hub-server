import { Link } from 'react-router-dom'
import { MODULES, totalLessonCount } from '../data/modules'
import { moduleItems } from '../lib/moduleProgress'
import { Button } from '../components/Button'
import { useAuth } from '../store/auth'

const FEATURES = [
  {
    color: 'bg-warn',
    shape: 'rounded-full',
    title: 'Clearer instructions',
    body: 'Write prompts that say exactly what you mean, every time.',
  },
  {
    color: 'bg-accent',
    shape: 'h-3.5 rounded-pill',
    title: 'Guided reasoning',
    body: 'Structure multi-step tasks so the model reasons reliably.',
  },
  {
    color: 'bg-success',
    shape: 'rounded-control',
    title: 'Output control',
    body: 'Get consistent format, tone, and length — every time.',
  },
  {
    color: 'bg-text',
    shape: 'rounded-full',
    title: 'Evaluated, not guessed',
    body: 'Score your own prompts and pass a real final exam to get certified.',
  },
]

export function Landing() {
  const totalLessons = totalLessonCount()
  const { user, loading } = useAuth()

  return (
    <div className="mx-auto max-w-[1120px] px-6 pb-24 pt-16 sm:px-12">
      <div className="flex flex-col items-start gap-12 lg:flex-row lg:items-center">
        <div className="flex-1">
          <div className="mb-5 inline-block rounded-pill bg-success-soft px-3 py-1.5 text-[13px] font-bold text-success">
            Internal training · Zawadie Solutions
          </div>
          <h1 className="mb-5 font-display text-4xl font-bold leading-[1.05] tracking-tight text-text sm:text-5xl">
            Prompt engineering, <span className="text-accent">taught properly.</span>
          </h1>
          <p className="mb-8 max-w-[520px] text-lg leading-relaxed text-text-soft">
            A hands-on course for Zawadie agents — six modules, real exercises, a prompt
            evaluation tool, and a final exam that earns you a certificate.
          </p>
          {!loading && (
            <div className="flex flex-wrap gap-3.5">
              {user ? (
                <Link to="/dashboard">
                  <Button className="px-6 py-3.5 text-base">Go to your dashboard</Button>
                </Link>
              ) : (
                <a href="/">
                  <Button className="px-6 py-3.5 text-base">Go to the Zawadie Hub</Button>
                </a>
              )}
            </div>
          )}
          <p className="mt-4 text-[13px] text-text-softer">
            {user
              ? `Signed in as ${user.email}. Your progress is saved automatically.`
              : 'Open this course through the Zawadie Hub — that’s where every employee signs in once to reach every solution they’ve been given access to.'}
          </p>
        </div>

        <div className="w-full max-w-[340px] shrink-0 rounded-panel border border-border bg-surface p-7 shadow-[0_20px_40px_-20px_rgba(34,29,26,0.15)]">
          <div className="mb-4 font-display text-[15px] font-bold text-text">Course at a glance</div>
          <div className="flex flex-col gap-3.5 text-sm">
            <div className="flex justify-between">
              <span className="text-text-soft">Modules</span>
              <span className="font-bold text-text">{MODULES.length}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-soft">Lessons</span>
              <span className="font-bold text-text">{totalLessons}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-soft">Format</span>
              <span className="font-bold text-text">Self-paced, linear</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-soft">Exercises</span>
              <span className="font-bold text-text">Live prompt playground</span>
            </div>
            <div className="my-1 h-px bg-border" />
            <div className="text-[13px] text-text-softer">
              Finish all six modules and pass the final exam at 80%+ to unlock your Zawadie
              PromptClass certificate.
            </div>
          </div>
        </div>
      </div>

      <div className="mt-24">
        <h2 className="mb-7 font-display text-[26px] font-bold text-text">
          What you'll walk away with
        </h2>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-card border border-border bg-surface p-5">
              <div className={`mb-3.5 h-9 w-9 ${f.color} ${f.shape}`} />
              <div className="mb-1.5 text-[15px] font-bold text-text">{f.title}</div>
              <div className="text-[13.5px] leading-relaxed text-text-soft">{f.body}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-20">
        <h2 className="mb-7 font-display text-[26px] font-bold text-text">The curriculum</h2>
        <div className="flex flex-col gap-3">
          {MODULES.map((m) => (
            <div
              key={m.id}
              className="flex items-center gap-5 rounded-card border border-border bg-surface px-6 py-5"
            >
              <div className="w-7 font-display text-xl font-bold text-border-input">{m.order}</div>
              <div className="flex-1">
                <div className="mb-1 text-[15.5px] font-bold text-text">{m.title}</div>
                <div className="text-[13.5px] text-text-soft">{m.blurb}</div>
              </div>
              <div className="whitespace-nowrap text-[13px] text-text-softer">
                {moduleItems(m).length} lessons
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
