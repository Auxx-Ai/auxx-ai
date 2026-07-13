// packages/ui/src/components/calendar/utils.ts

import {
  addDays,
  differenceInCalendarDays,
  eachDayOfInterval,
  endOfDay,
  endOfMonth,
  endOfWeek,
  format,
  isAfter,
  isBefore,
  isSameDay,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from 'date-fns'
import type { DateRange, DisabledResolverOptions } from './types'

/**
 * Full weeks (7-day rows) covering `month`, respecting `weekStartsOn` — includes the
 * leading/trailing days from adjacent months needed to complete the first and last row.
 *
 * When `fixedWeeks` is set, short months (4–5 rows) are padded with trailing days to always
 * render 6 rows, so the calendar's height stays constant across months (no layout shift).
 */
export function getMonthWeeks(
  month: Date,
  weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6 = 0,
  fixedWeeks = false
): Date[][] {
  const start = startOfWeek(startOfMonth(month), { weekStartsOn })
  const naturalEnd = endOfWeek(endOfMonth(month), { weekStartsOn })
  const weekCount = (differenceInCalendarDays(naturalEnd, start) + 1) / 7
  const end = fixedWeeks && weekCount < 6 ? addDays(naturalEnd, (6 - weekCount) * 7) : naturalEnd
  const days = eachDayOfInterval({ start, end })

  const weeks: Date[][] = []
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7))
  }
  return weeks
}

/** `'yyyy-MM-dd'` key for a date — used for the `data-day` focus-lookup attribute and list keys. */
export function toDayKey(date: Date): string {
  return format(date, 'yyyy-MM-dd')
}

/**
 * True when `date` falls inside `range` (inclusive of both ends). Requires a complete range
 * (`to` set) — a `from`-only range has no "middle", it's just a single selected day.
 */
export function isInRange(date: Date, range: DateRange | undefined): boolean {
  if (!range?.to) return false
  const day = startOfDay(date)
  return !isBefore(day, startOfDay(range.from)) && !isAfter(day, startOfDay(range.to))
}

/** True when `date` is the start (`from`) of `range`. */
export function isRangeStart(date: Date, range: DateRange | undefined): boolean {
  return !!range && isSameDay(date, range.from)
}

/** True when `date` is the end (`to`) of `range`. False while `to` is unset. */
export function isRangeEnd(date: Date, range: DateRange | undefined): boolean {
  return !!range?.to && isSameDay(date, range.to)
}

/**
 * A day is disabled if the caller's predicate says so, or it falls outside
 * `[minDate, maxDate]` (compared at day granularity).
 */
export function isDayDisabled(date: Date, options: DisabledResolverOptions): boolean {
  if (options.disabled?.(date)) return true
  if (options.minDate && isBefore(date, startOfDay(options.minDate))) return true
  if (options.maxDate && isAfter(date, endOfDay(options.maxDate))) return true
  return false
}
