// packages/lib/src/availability/dates.ts
//
// Plain calendar-date math for `YYYY-MM-DD` strings — never timezone conversion
// (05-availability.md §A.2: "everything calendar-date math (no tz conversions server-side)").
// Dates are parsed as UTC midnight purely to get integer day arithmetic out of `Date`; the
// result strings/day-of-week never leave the UTC calendar frame.

import { BadRequestError } from '../errors'

const MS_PER_DAY = 24 * 60 * 60 * 1000
/** `resolveAvailability`/`addException` span cap (05-availability.md §A.2). */
export const MAX_DATE_RANGE_DAYS = 366

function toUTCDate(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00Z`)
}

/** Number of days from `a` to `b` (positive when `b` is after `a`). */
export function diffDays(a: string, b: string): number {
  return Math.round((toUTCDate(b).getTime() - toUTCDate(a).getTime()) / MS_PER_DAY)
}

/** `date` shifted by `days` (may be negative), formatted back to `YYYY-MM-DD`. */
export function addDaysToDate(dateStr: string, days: number): string {
  const d = toUTCDate(dateStr)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** 0-6, 0 = Sunday — JS `getDay()` convention, from a `YYYY-MM-DD` calendar date. */
export function dayOfWeekFromDate(dateStr: string): number {
  return toUTCDate(dateStr).getUTCDay()
}

/**
 * Every `YYYY-MM-DD` date from `from` to `to` inclusive. Throws `BadRequestError` when
 * `to` precedes `from` or the span exceeds {@link MAX_DATE_RANGE_DAYS}.
 */
export function enumerateDates(from: string, to: string, maxDays = MAX_DATE_RANGE_DAYS): string[] {
  const span = diffDays(from, to) + 1
  if (span <= 0) {
    throw new BadRequestError('`to` date must be on or after `from` date')
  }
  if (span > maxDays) {
    throw new BadRequestError(`Date range cannot exceed ${maxDays} days`)
  }

  const dates: string[] = []
  for (let i = 0; i < span; i++) {
    dates.push(addDaysToDate(from, i))
  }
  return dates
}
