// Absolute, since this page is also served standalone on promtkit.vercel.app
// (see vite.config.ts) where a relative "/" link would just reload itself
// instead of reaching the real Hub. Override with VITE_HUB_URL in a local,
// gitignored .env.local while testing against a hub running on localhost —
// the production default below is untouched by that override.
export const HUB_URL = import.meta.env.VITE_HUB_URL || 'https://ai.zawadie.com/'

export interface AuthUser {
  id: number
  email: string
  displayName: string
}

export interface RemoteProgress {
  points: number
  streak: number
  lastActiveDate: string | null
  completedExercises: Record<string, number>
  quizPassed: { examPassed?: boolean; examScore?: number; examAttempted?: boolean }
  badges: string[]
}

export interface LeaderboardEntry {
  displayName: string
  points: number
}

// BASE_URL carries whatever `base` vite.config.ts is configured with.
const API_ROOT = `${import.meta.env.BASE_URL}api`.replace(/\/+/g, '/')

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_ROOT}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error(data?.error ?? `Request failed (${res.status})`)
  }
  return data as T
}

export const api = {
  // Clears this app's own fallback session cookie, if any — the real
  // sign-out is the hub's (see store/auth.tsx signOut).
  signOut: () => request<{ ok: true }>('/auth/signout', { method: 'POST' }),
  me: () => request<{ user: AuthUser | null; progress: RemoteProgress | null }>('/auth/me'),
  leaderboard: () => request<{ entries: LeaderboardEntry[] }>('/leaderboard'),
  saveProgress: (body: RemoteProgress) =>
    request<{ ok: true }>('/progress', { method: 'PUT', body: JSON.stringify(body) }),
}
