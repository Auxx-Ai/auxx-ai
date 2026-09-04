// packages/lib/src/postings/reports/fiscal-year.ts
//
// PURE. Calendar-date arithmetic the balance sheet and the account-lines
// drill-down both need: the fiscal year's first day, and the day before a
// given day.
//
// ⚠️ **Calendar-day arithmetic, not instant arithmetic.** `periods.ts`'s
// warning about `bookTimeZone` is about deriving a `periodKey` from an INSTANT
// (a `Date`) - that has to go through `Intl.DateTimeFormat` in the org's own
// zone, or a receipt near midnight lands in the wrong day. Nothing here does
// that: every input and output is already a `YYYY-MM-DD` calendar date (a
// `GlPosting.txnDate`, or a report's `asOf`), and stepping from one calendar
// date to the adjacent one is timezone-free by construction - `2026-08-31`'s
// previous day is `2026-08-30` in every zone there is.
//
// FISCAL YEAR. There is no `accounting.fiscalYear*` setting in the catalog
// (checked: `packages/lib/src/settings/catalog.ts` has none), so every
// organization's fiscal year is assumed to be the calendar year, per the task
// brief's explicit fallback. If a fiscal-year-start setting is added later,
// {@link fiscalYearStart} is the one function that needs to change.

import { BadRequestError } from '../../errors'

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

function parseCalendarDate(date: string): { year: number; month: number; day: number } {
  const match = DAY_PATTERN.exec(date)
  if (!match) {
    throw new BadRequestError(`Expected a YYYY-MM-DD date, got "${date}"`, { date })
  }
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
}

function formatCalendarDate(utcMs: number): string {
  return new Date(utcMs).toISOString().slice(0, 10)
}

/**
 * `'2026-01-01'` for any date in 2026. The calendar-fiscal-year assumption -
 * see the file header.
 */
export function fiscalYearStart(date: string): string {
  const { year } = parseCalendarDate(date)
  return `${String(year).padStart(4, '0')}-01-01`
}

/**
 * The calendar day immediately before `date`. `'2026-01-01'` -> `'2025-12-31'`.
 *
 * Goes through `Date.UTC` and back rather than hand-rolled month/year
 * rollover, for the same reason `periods.ts`'s `assertRealDate` does: manual
 * day-in-month tables get February and year boundaries wrong far more often
 * than the platform's own calendar math does.
 */
export function previousCalendarDay(date: string): string {
  const { year, month, day } = parseCalendarDate(date)
  return formatCalendarDate(Date.UTC(year, month - 1, day - 1))
}
