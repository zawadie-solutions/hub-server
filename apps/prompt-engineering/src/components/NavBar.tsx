import { Link, NavLink } from 'react-router-dom'
import { Flame, LogOut } from 'lucide-react'
import { useProgress } from '../store/progress'
import { useAuth } from '../store/auth'
import { Logo, LogoMark } from './Logo'

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `border-b-2 pb-1 text-sm font-bold transition-colors ${
    isActive
      ? 'border-accent text-text'
      : 'border-transparent text-text-softer hover:border-border-input hover:text-text'
  }`

export function NavBar() {
  const { points, streak } = useProgress()
  const { user, signOut } = useAuth()

  // No signed-in identity — normally only reachable by opening this app
  // directly instead of through the Zawadie Hub, which is the one sign-in
  // for every solution (see api/_lib/auth.ts).
  if (!user) {
    return (
      <header>
        <div className="mx-auto flex max-w-[1280px] items-center justify-between gap-3 px-6 py-5 sm:px-12">
          <Link to="/">
            <Logo />
          </Link>
          <a
            href="/"
            className="rounded-control bg-accent px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-accent-hover"
          >
            Go to the Zawadie Hub
          </a>
        </div>
      </header>
    )
  }

  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex max-w-[1280px] items-center justify-between px-6 py-4 sm:px-12">
        <div className="flex items-center gap-8">
          <Link to="/dashboard" className="flex items-center gap-2.5">
            <LogoMark size={28} />
            <span className="font-display text-[17px] font-bold text-text">
              Zawadie <span className="text-accent">PromptClass</span>
            </span>
          </Link>
          <nav className="hidden gap-6 sm:flex">
            <NavLink to="/dashboard" className={navLinkClass}>
              Dashboard
            </NavLink>
            <NavLink to="/progress" className={navLinkClass}>
              Progress
            </NavLink>
            <NavLink to="/evaluate" className={navLinkClass}>
              Evaluate
            </NavLink>
            <NavLink to="/leaderboard" className={navLinkClass}>
              Leaderboard
            </NavLink>
          </nav>
        </div>

        <div className="flex items-center gap-3.5">
          <span className="hidden items-center gap-1 text-xs font-bold text-warn sm:flex">
            <Flame className="h-3.5 w-3.5" />
            {streak}
          </span>
          <span className="hidden text-xs font-bold text-text-soft sm:inline">{points} pts</span>
          <span className="hidden text-sm text-text-soft md:inline">Hi, {user.displayName.split(' ')[0]}</span>
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-warn text-[13px] font-bold text-text">
            {user.displayName
              .split(' ')
              .map((w) => w[0])
              .slice(0, 2)
              .join('')
              .toUpperCase()}
          </div>
          <button
            type="button"
            onClick={signOut}
            className="flex items-center gap-1 text-[13px] font-semibold text-text-softer hover:text-accent"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Log out</span>
          </button>
        </div>
      </div>
    </header>
  )
}
