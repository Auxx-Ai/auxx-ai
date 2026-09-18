// apps/web/src/components/accounting/ui/settings/posting-schedule.ts

// When a scheduled posting type fires next, computed in the browser from the
// policy's own cron (plans/accounting/tasks/done/28-how-your-books-post.md §3.2).
//
// PURE: no React, no clock of its own. `now` is a parameter so the test can pin
// "today" against "tomorrow" without faking timers. Only a `schedule` trigger
// has a next fire; an event, console or inbound trigger is a sentence, not a
// time, and returns null here so the caller prints the sentence instead.

import type { PostingTrigger } from '@auxx/lib/accounting/ledger/client'
import { Cron } from 'croner'

/** The next fire of a `schedule` trigger strictly after `now`, or null for every other kind. */
export function nextScheduledFire(trigger: PostingTrigger, now: Date = new Date()): Date | null {
  if (trigger.kind !== 'schedule') return null
  // No callback, so nothing is scheduled: croner only starts a timer when it is
  // handed a function. This is a calculator over the pattern.
  return new Cron(trigger.cron, { timezone: trigger.tz }).nextRun(now)
}

/**
 * `today at 04:30 UTC`, `tomorrow at 04:30 UTC`, or `on Sep 16 at 04:30 UTC`.
 *
 * Day boundaries are taken in UTC because every policy schedule is declared in
 * UTC; a browser in Sydney still reads "04:30 UTC" and the day word answers
 * "is that the next UTC day", which is what the worker's clock is on.
 */
export function describeNextFire(next: Date, now: Date = new Date()): string {
  const time = `${pad(next.getUTCHours())}:${pad(next.getUTCMinutes())} UTC`
  const dayDelta = utcDayNumber(next) - utcDayNumber(now)
  if (dayDelta <= 0) return `today at ${time}`
  if (dayDelta === 1) return `tomorrow at ${time}`
  const day = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(next)
  return `on ${day} at ${time}`
}

function utcDayNumber(date: Date): number {
  return Math.floor(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 86_400_000
  )
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}
