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

// BASE_URL carries whatever `base` vite.config.ts is configured with
// ('/prompt-engineering/' behind the hub, '/' when run standalone).
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
