// apps/web/src/components/accounting/ui/journal/period-helpers.ts

import type { ClosePeriod } from '@auxx/lib/postings/client'

/**
 * Pure date/period helpers the JE drawer needs and that nothing in `ledger/`
 * already exports. Kept small and testable on purpose - this file has no React
 * in it.
 */

const MONTH_PATTERN = /^(\d{4})-(\d{2})$/

/** `'2026-08'` -> `'2026-08-01'`. Returns the input unchanged if it is not a month key. */
export function firstDayOfPeriod(periodKey: string): string {
  const match = MONTH_PATTERN.exec(periodKey)
  if (!match) return periodKey
  return `${match[1]}-${match[2]}-01`
}

/**
 * `'2026-08'` -> `'2026-08-31'`. Returns the input unchanged if it is not a
 * month key.
 *
 * The JE drawer's Date field defaults to this: the last day of the period the
 * bookkeeper is looking at, per `ui-plan.md` §2.1.
 */
export function lastDayOfPeriod(periodKey: string): string {
  const match = MONTH_PATTERN.exec(periodKey)
  if (!match) return periodKey
  const year = Number(match[1])
  const month = Number(match[2])
  // Day 0 of the NEXT month is the last day of THIS one.
  const last = new Date(Date.UTC(year, month, 0))
  return last.toISOString().slice(0, 10)
}

/**
 * The month a `YYYY-MM-DD` accounting date belongs to, or `null` for anything
 * that is not one (a Date field mid-edit is blank).
 *
 * 🛑 **No time zone.** An accounting date is a CALENDAR DAY, not an instant:
 * `journal_entry.date` is stored as `YYYY-MM-DD` and the server evaluates the
 * period lock against that raw string. Routing it through `periodKeyForDate`,
 * which formats a `Date` in the book zone, showed `2026-09-01` as August 2026
 * in every zone west of UTC - the drawer's Period badge disagreeing with the
 * period the post would actually claim. Same reduction `report-helpers.ts`'
 * `periodKeyFromDate` makes, for the same reason.
 */
export function periodKeyForEntryDate(date: string): string | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date.slice(0, 7) : null
}

/**
 * The first OPEN period strictly after `periodKey`, or - if none exists past
 * it - the first open period anywhere in the list. `null` when nothing in the
 * org is open at all.
 *
 * `periods` is `ledger.periods`' own order: cutoff forward, oldest first
 * (`use-ledger-period.ts`). This is what `period_closed`'s "post to the next
 * open period" remedy re-dates a locked entry to.
 */
export function nextOpenPeriodAfter(periods: ClosePeriod[], periodKey: string): ClosePeriod | null {
  const index = periods.findIndex((period) => period.periodKey === periodKey)
  const after = index >= 0 ? periods.slice(index + 1) : periods
  return after.find((period) => period.state === 'open') ?? findFirstOpen(periods)
}

function findFirstOpen(periods: ClosePeriod[]): ClosePeriod | null {
  return periods.find((period) => period.state === 'open') ?? null
}

/**
 * `YYYY-MM-DD` for "now", in the given time zone. The JE drawer's fallback
 * default date when there is no active ledger period to derive one from - an
 * org with no month open yet (cutoff still ahead of the wall clock, or setup
 * not finalized) still needs SOME valid date to raise a draft against, and an
 * empty string fails `journalEntry.create`'s `YYYY-MM-DD` check outright.
 */
export function today(timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}
