import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, type AuthUser } from '../lib/api'

interface AuthApi {
  user: AuthUser | null
  loading: boolean
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthApi | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Identity comes from the Zawadie Hub's login (see api/_lib/auth.ts) —
    // there's no local signup/signin anymore, only this read.
    api
      .me()
      .then((res) => setUser(res.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false))
  }, [])

  // There's only one real sign-out now: the hub's. Clear this app's local
  // fallback session first, then sign out of the hub itself so re-entering
  // any solution asks for a fresh hub login.
  const signOut = async () => {
    await api.signOut().catch(() => {})
    await fetch('/logout', { method: 'POST' })
    window.location.href = '/'
  }

  return <AuthContext.Provider value={{ user, loading, signOut }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
