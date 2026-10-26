import { useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { Flame, LogOut, Menu, X } from 'lucide-react'
import { useProgress } from '../store/progress'
import { useAuth } from '../store/auth'
import { HUB_URL } from '../lib/api'
import { LogoMark } from './Logo'

const NAV_LINKS = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/progress', label: 'Progress' },
  { to: '/evaluate', label: 'Evaluate' },
  { to: '/leaderboard', label: 'Leaderboard' },
]

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `border-b-2 pb-1 text-sm font-bold transition-colors ${
    isActive
      ? 'border-accent text-text'
      : 'border-transparent text-text-softer hover:border-border-input hover:text-text'
  }`

const mobileNavLinkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-control px-3 py-2.5 text-sm font-bold transition-colors ${
    isActive ? 'bg-accent-soft text-accent' : 'text-text-soft hover:bg-track hover:text-text'
  }`

export function NavBar() {
  const { points, streak } = useProgress()
  const { user, signOut } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)

  // Progress, evaluate, and the leaderboard all work from this device alone
  // (see store/progress.tsx), so the course itself never needs a hub
  // sign-in — only the "Go to the Zawadie Hub" CTA below changes based on it.
  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex max-w-[1280px] items-center justify-between px-6 py-4 sm:px-12">
        <div className="flex items-center gap-8">
          <Link to={user ? '/dashboard' : '/'} className="flex items-center gap-2.5">
            <LogoMark size={28} />
            <span className="font-display text-[17px] font-bold text-text">
              Zawadie <span className="text-accent">PromptClass</span>
            </span>
          </Link>
          <nav className="hidden gap-6 sm:flex">
            {NAV_LINKS.map((link) => (
              <NavLink key={link.to} to={link.to} className={navLinkClass}>
                {link.label}
              </NavLink>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-3.5">
          {user ? (
            <>
              <span className="hidden items-center gap-1 text-xs font-bold text-warn sm:flex">
                <Flame className="h-3.5 w-3.5" />
                {streak}
              </span>
              <span className="hidden text-xs font-bold text-text-soft sm:inline">{points} pts</span>
              <span className="hidden text-sm text-text-soft md:inline">
                Hi, {user.displayName.split(' ')[0]}
              </span>
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
            </>
          ) : (
            <a
              href={HUB_URL}
              className="hidden rounded-control bg-accent px-4 py-2 text-[13px] font-bold text-white transition-colors hover:bg-accent-hover sm:inline-block"
            >
              Sign in via Zawadie Hub
            </a>
          )}
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            className="flex h-8 w-8 items-center justify-center rounded-control text-text-soft hover:bg-track hover:text-text sm:hidden"
          >
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {menuOpen && (
        <nav className="flex flex-col gap-1 border-t border-border px-6 py-3 sm:hidden">
          {NAV_LINKS.map((link) => (
            <NavLink key={link.to} to={link.to} className={mobileNavLinkClass} onClick={() => setMenuOpen(false)}>
              {link.label}
            </NavLink>
          ))}
          {!user && (
            <a
              href={HUB_URL}
              className="mt-2 rounded-control bg-accent px-3 py-2.5 text-center text-sm font-bold text-white hover:bg-accent-hover"
              onClick={() => setMenuOpen(false)}
            >
              Sign in via Zawadie Hub
            </a>
          )}
        </nav>
      )}
    </header>
  )
}
