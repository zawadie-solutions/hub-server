/** Next wall-clock occurrence of `hour:minute` in `timeZone`, strictly after `from`. */
export function nextDailyRun(hour: number, minute: number, timeZone: string, from = new Date()): Date {
  const partsAt = (d: Date) => {
    const p = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(d);
    const get = (t: string) => Number(p.find((x) => x.type === t)?.value);
    return { y: get("year"), mo: get("month"), d: get("day"), h: get("hour") === 24 ? 0 : get("hour"), mi: get("minute"), s: get("second") };
  };
  const cur = partsAt(from);
  // Guess the UTC instant for today's hour:minute in `timeZone`, then correct for its offset
  // by comparing what that guess actually renders as in `timeZone` (converges in one step
  // for fixed-offset zones, two for safety across a DST boundary).
  let guessMs = Date.UTC(cur.y, cur.mo - 1, cur.d, hour, minute, 0);
  for (let i = 0; i < 2; i++) {
    const got = partsAt(new Date(guessMs));
    const gotMs = Date.UTC(got.y, got.mo - 1, got.d, got.h, got.mi, got.s);
    const wantMs = Date.UTC(cur.y, cur.mo - 1, cur.d, hour, minute, 0);
    guessMs += wantMs - gotMs;
  }
  if (guessMs <= from.getTime()) guessMs += 24 * 60 * 60 * 1000;
  return new Date(guessMs);
}

/** Next run of a simple "M H * * *" (daily at H:M) cron expression, or null for anything more complex. */
export function nextScheduledRun(cronExpr: string, timeZone: string, from = new Date()): Date | null {
  const [minute, hour, dom, month, dow] = cronExpr.trim().split(/\s+/);
  if (dom !== "*" || month !== "*" || dow !== "*") return null;
  const h = Number(hour);
  const m = Number(minute);
  if (!Number.isInteger(h) || !Number.isInteger(m)) return null;
  return nextDailyRun(h, m, timeZone, from);
}
