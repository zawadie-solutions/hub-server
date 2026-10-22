export interface Rank {
  name: string
  min: number
}

export const RANKS: Rank[] = [
  { name: 'Beginner', min: 0 },
  { name: 'Practitioner', min: 65 },
  { name: 'Expert', min: 160 },
  { name: 'Master', min: 280 },
]

export function rankForPoints(points: number): Rank {
  let current = RANKS[0]
  for (const rank of RANKS) {
    if (points >= rank.min) current = rank
  }
  return current
}

export function nextRank(points: number): Rank | null {
  return RANKS.find((rank) => rank.min > points) ?? null
}
