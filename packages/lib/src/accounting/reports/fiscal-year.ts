// packages/lib/src/accounting/reports/fiscal-year.ts
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
// FISCAL YEAR. The org's first month comes from
// `accounting.fiscalYearStartMonth`, resolved server-side by
// `fiscal-year-setting.ts` and client-side by `useLedgerPeriod`. This file
// stays pure and takes the month as an argument, so the catalog (which must
// stay client-safe) can import the option list from it.

import { previousDayKey } from '@auxx/utils/calendar-day'
import { BadRequestError } from '../../errors'

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

/** `accounting.fiscalYearStartMonth`. Spelled here so the readers and the catalog agree. */
export const FISCAL_YEAR_START_MONTH_SETTING_KEY = 'accounting.fiscalYearStartMonth'

/**
 * January - the calendar year.
 *
 * 🔑 Unlike `accounting.bookTimeZone`, which fails closed because a guessed zone
 * files a receipt into the wrong month, an unset fiscal year has no such
 * failure: January is exactly what every report assumed before this key
 * existed, so an org that never sets it reads as it always did.
 */
export const DEFAULT_FISCAL_YEAR_START_MONTH = 1

const MONTH_LABELS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const

/** The `SINGLE_SELECT` options for `accounting.fiscalYearStartMonth`. Values are `'1'`-`'12'`. */
export const FISCAL_YEAR_START_MONTH_OPTIONS = MONTH_LABELS.map((label, index) => ({
  value: String(index + 1),
  label,
}))

function parseCalendarDate(date: string): { year: number; month: number; day: number } {
  const match = DAY_PATTERN.exec(date)
  if (!match) {
    throw new BadRequestError(`Expected a YYYY-MM-DD date, got "${date}"`, { date })
  }
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
}

/**
 * A stored setting value as a month number, falling back to January.
 *
 * 🛑 Falls back rather than throwing because both callers are read paths: a
 * hand-edited row holding `'0'` must not take down every statement in the org.
 * {@link fiscalYearStart} throws on a bad month because by then it is a
 * programmer error - this is the only door a stored value comes through.
 */
export function normalizeFiscalYearStartMonth(value: unknown): number {
  const month = typeof value === 'string' ? Number(value.trim()) : value
  if (typeof month !== 'number' || !Number.isInteger(month) || month < 1 || month > 12) {
    return DEFAULT_FISCAL_YEAR_START_MONTH
  }
  return month
}

/**
 * The first day of the fiscal year `date` falls in.
 *
 * With `startMonth` 1 (the default) this is `'2026-01-01'` for any date in 2026.
 * With 7, `'2026-09-16'` is `'2026-07-01'` and `'2026-03-16'` is `'2025-07-01'`:
 * a date before the start month belongs to the year that opened the previous
 * calendar year.
 *
 * @throws {BadRequestError} when `date` is not `YYYY-MM-DD`, or `startMonth` is
 * not an integer 1-12. Pass a value through {@link normalizeFiscalYearStartMonth}
 * first when it came from storage.
 */
export function fiscalYearStart(
  date: string,
  startMonth: number = DEFAULT_FISCAL_YEAR_START_MONTH
): string {
  const { year, month } = parseCalendarDate(date)
  if (!Number.isInteger(startMonth) || startMonth < 1 || startMonth > 12) {
    throw new BadRequestError(`Expected a fiscal-year start month 1-12, got ${startMonth}`, {
      startMonth: String(startMonth),
    })
  }
  const startYear = month >= startMonth ? year : year - 1
  return `${String(startYear).padStart(4, '0')}-${String(startMonth).padStart(2, '0')}-01`
}

/**
 * The calendar day immediately before `date`. `'2026-01-01'` -> `'2025-12-31'`.
 *
 * Parses first so a malformed `asOf` is refused here, by name, rather than
 * passed through unchanged as a day that silently equals its own predecessor.
 */
export function previousCalendarDay(date: string): string {
  parseCalendarDate(date)
  return previousDayKey(date)
}
