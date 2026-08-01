// packages/lib/src/recurrence/expand.ts
//
// Pure occurrence expansion for a `RecurrencePattern` (plans/dispatch/06-recurring-engine.md
// §2.2) — the "own expander" decision (§1): NOT the `rrule` npm package, ~150 lines of
// date-fns instead. Wall-clock semantics: iterate LOCAL calendar dates in the rule's
// `timezone` and convert each candidate date + `startMinute` to a UTC instant via
// `fromZonedTime`, so "9:00 AM every Tuesday" stays 9:00 AM local across a DST transition.

import {
  addDays,
  differenceInCalendarDays,
  differenceInCalendarWeeks,
  format,
  getDay,
  getDaysInMonth,
} from 'date-fns'
import { fromZonedTime, toZonedTime } from 'date-fns-tz'
import type { RecurrencePattern } from './types'

/**
 * One materialized occurrence. `occurrenceDate` is the local-date slot identity (a consumer's
 * row keeps this even if the row is later individually rescheduled — see
 * `WorkOrderVisit.occurrenceDate`, 06-recurring-engine.md §3.2); `start` is the UTC instant.
 */
export interface RecurrenceOccurrence {
  occurrenceDate: string
  start: Date
}

export interface ExpandOccurrencesOptions {
  /** Series start, local ISO date (`YYYY-MM-DD`) — the expansion origin ("week 0"/"month 0"). */
  anchor: string
  /** IANA timezone the pattern's dates/times are local to. */
  timezone: string
  /** Only occurrences whose UTC `start` falls in `[from, to]` (inclusive) are returned. */
  from: Date
  to: Date
  /** Wall-clock minutes since local midnight (`0`-`1439`). */
  startMinute: number
  /**
   * Occurrences already produced strictly before `from` — the authoritative prior-consumption
   * count for `pattern.count`-based ends. Callers (the materializer) derive this from existing
   * rows linked to the rule; this function does not re-derive it by walking from the anchor.
   * Defaults to `0`.
   */
  countConsumed?: number
}

/**
 * Fixed week-bucketing convention used only for "every N weeks" interval alignment —
 * Sunday-start, independent of the org `weekStart` display setting (that setting only orders
 * `describeRecurrence`'s weekday list). "Week 0" is the calendar week (Sun-Sat) containing
 * `anchor`; a candidate date belongs to an active week when
 * `weeksSinceAnchorWeek % interval === 0`.
 */
const ALIGNMENT_WEEK_START = 0

/** Parse a local ISO date (`YYYY-MM-DD`) into a naive local `Date` (midnight, host-local
 * getters/setters) — the same representation `toZonedTime`/`fromZonedTime` round-trip through. */
function parseLocalDate(iso: string): Date {
  const [year = 0, month = 1, day = 1] = iso.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function localDateKey(local: Date): string {
  return format(local, 'yyyy-MM-dd')
}

/** Local calendar date + wall-clock minutes → the UTC instant, DST-safe. */
function toUtcStart(local: Date, startMinute: number, timezone: string): Date {
  const wallClock = new Date(local)
  wallClock.setHours(Math.floor(startMinute / 60), startMinute % 60, 0, 0)
  return fromZonedTime(wallClock, timezone)
}

function monthsBetween(from: Date, to: Date): number {
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth())
}

/** The nth (1-4) or last (-1) occurrence of `weekday` within the given local month. Every
 * month has at least 4 of each weekday, so nth 1-4 always resolves inside the month. */
function nthWeekdayOfMonth(year: number, monthIndex0: number, weekday: number, nth: number): Date {
  if (nth === -1) {
    let last = new Date(year, monthIndex0 + 1, 0) // day 0 of next month = last day of this one
    while (getDay(last) !== weekday) last = addDays(last, -1)
    return last
  }
  let first = new Date(year, monthIndex0, 1)
  while (getDay(first) !== weekday) first = addDays(first, 1)
  return addDays(first, (nth - 1) * 7)
}

/**
 * Local candidate dates in `[rangeStart, rangeEnd]` (inclusive; both already `>= anchorLocal`)
 * satisfying the pattern's frequency/interval/weekday|monthDay|nthWeekday shape. Ascending.
 */
function candidateDates(
  pattern: RecurrencePattern,
  anchorLocal: Date,
  rangeStart: Date,
  rangeEnd: Date
): Date[] {
  const dates: Date[] = []
  if (rangeStart > rangeEnd) return dates

  if (pattern.frequency === 'monthly') {
    const startMonthOffset = Math.max(0, monthsBetween(anchorLocal, rangeStart))
    const endMonthOffset = Math.max(startMonthOffset, monthsBetween(anchorLocal, rangeEnd))
    for (let offset = startMonthOffset; offset <= endMonthOffset; offset++) {
      if (offset % pattern.interval !== 0) continue
      const totalMonths = anchorLocal.getMonth() + offset
      const year = anchorLocal.getFullYear() + Math.floor(totalMonths / 12)
      const monthIndex0 = totalMonths % 12
      const candidate = pattern.nthWeekday
        ? nthWeekdayOfMonth(year, monthIndex0, pattern.nthWeekday.weekday, pattern.nthWeekday.nth)
        : new Date(
            year,
            monthIndex0,
            Math.min(pattern.monthDay ?? 1, getDaysInMonth(new Date(year, monthIndex0, 1)))
          )
      if (candidate >= anchorLocal && candidate >= rangeStart && candidate <= rangeEnd) {
        dates.push(candidate)
      }
    }
    return dates
  }

  // daily / weekly: day-by-day scan. Bounded to the caller's window (~2 months at most), so a
  // simple loop is both correct and fast enough — no need for closed-form jump math.
  for (let d = rangeStart; d <= rangeEnd; d = addDays(d, 1)) {
    if (d < anchorLocal) continue
    if (pattern.frequency === 'daily') {
      if (differenceInCalendarDays(d, anchorLocal) % pattern.interval === 0) dates.push(d)
      continue
    }
    const weekIndex = differenceInCalendarWeeks(d, anchorLocal, {
      weekStartsOn: ALIGNMENT_WEEK_START,
    })
    const dayOfWeek = getDay(d)
    if (
      (pattern.weekdays ?? []).some((w) => w === dayOfWeek) &&
      weekIndex % pattern.interval === 0
    ) {
      dates.push(d)
    }
  }
  return dates
}

/**
 * Expand a `RecurrencePattern` into concrete occurrences intersecting `[from, to]`. Wall-clock
 * semantics: the local calendar date + `startMinute` in `timezone` converts to a UTC instant
 * via `fromZonedTime`, so a 9:00 AM local rule stays 9:00 AM local across DST.
 *
 * `pattern.count`-based ends use `countConsumed` as the authoritative "already produced"
 * number; occurrences are counted in the true series order (earliest-first), so the first
 * `count - countConsumed` occurrences intersecting the window are returned.
 */
export function expandOccurrences(
  pattern: RecurrencePattern,
  options: ExpandOccurrencesOptions
): RecurrenceOccurrence[] {
  const { anchor, timezone, from, to, startMinute, countConsumed = 0 } = options
  if (from > to) return []

  const remaining =
    pattern.count !== undefined ? Math.max(0, pattern.count - countConsumed) : undefined
  if (remaining === 0) return []

  const anchorLocal = parseLocalDate(anchor)
  const untilLocal = pattern.until ? parseLocalDate(pattern.until) : undefined

  // 1-day buffer on both ends absorbs the local-date/UTC-instant offset at the window edges
  // (any IANA zone's offset from UTC is within a single calendar day).
  const scanFromLocal = addDays(toZonedTime(from, timezone), -1)
  const scanToLocal = addDays(toZonedTime(to, timezone), 1)
  const rangeStart = scanFromLocal > anchorLocal ? scanFromLocal : anchorLocal
  const rangeEnd = untilLocal && untilLocal < scanToLocal ? untilLocal : scanToLocal

  const occurrences: RecurrenceOccurrence[] = []
  for (const local of candidateDates(pattern, anchorLocal, rangeStart, rangeEnd)) {
    const start = toUtcStart(local, startMinute, timezone)
    if (start >= from && start <= to) {
      occurrences.push({ occurrenceDate: localDateKey(local), start })
    }
  }

  // Cap AFTER the window filter (not before): anything filtered out above is by definition not
  // one of the "remaining" occurrences — it's already accounted for in `countConsumed` — so
  // capping post-filter can't misattribute an earlier, already-consumed slot into the budget.
  return remaining === undefined ? occurrences : occurrences.slice(0, remaining)
}
