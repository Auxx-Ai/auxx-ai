// apps/web/src/components/accounting/ui/ledger/sidebar/next-fire.ts

import { Cron } from 'croner'

/**
 * When a `schedule` posting policy next fires, from the cron on the policy
 * (plans/accounting/tasks/28-how-your-books-post.md §3.2 and §6).
 *
 * PURE: `from` is a parameter so the answer is the same on the server and in
 * a test. Every declared schedule is `tz: 'UTC'`, and the worker's cron runs
 * in UTC, so the pattern is evaluated there rather than in the viewer's zone -
 * a `30 4 * * *` job fires at 04:30 UTC wherever the person reading it sits.
 *
 * `null` for a pattern croner cannot parse or that never fires again. A policy
 * with a broken cron is a declaration bug, not something to throw about in a
 * sidebar.
 */
export function nextFire(cron: string, from: Date): Date | null {
  try {
    const next = new Cron(cron, { timezone: 'UTC', paused: true }).nextRun(from)
    return next ?? null
  } catch {
    return null
  }
}

const TIME_UTC = new Intl.DateTimeFormat('en-US', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'UTC',
})

const DAY_UTC = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
})

/**
 * `'today 04:30 UTC'`, `'tomorrow 04:30 UTC'`, or `'Sep 16, 04:30 UTC'`.
 *
 * The day word is relative to `now` in UTC, because the time is stated in UTC
 * and a "tonight" judged in the viewer's zone beside a UTC clock would be two
 * zones in one phrase. The zone is spelled out every time for the same reason.
 */
export function formatNextFire(next: Date, now: Date): string {
  const time = `${TIME_UTC.format(next)} UTC`
  const dayDelta = utcDayNumber(next) - utcDayNumber(now)
  if (dayDelta === 0) return `today ${time}`
  if (dayDelta === 1) return `tomorrow ${time}`
  return `${DAY_UTC.format(next)}, ${time}`
}

/** Whole UTC days since the epoch, so two instants on one UTC date compare equal. */
function utcDayNumber(date: Date): number {
  return Math.floor(date.getTime() / 86_400_000)
}
