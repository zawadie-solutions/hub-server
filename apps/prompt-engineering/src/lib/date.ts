export function todayKey(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10)
}

export function dayIndexSinceEpoch(date: Date = new Date()): number {
  return Math.floor(date.getTime() / 86400000)
}
