// packages/lib/src/resources/aggregate/date-buckets.ts
//
// Date-bucket SQL expressions + the matching JS-side bucket math (boundaries,
// enumeration for zero-fill, display labels). The SQL and JS sides MUST stay in
// lockstep: both truncate in the viewer's timezone, weeks are ISO (Monday
// start), and calendar bucket keys are the local bucket-start date `yyyy-MM-dd`.
// Cyclic granularities (dayOfWeek/monthOfYear) key as '1'-'7' / '1'-'12'.

import {
  addDays,
  addMonths,
  addQuarters,
  addWeeks,
  addYears,
  format,
  getISOWeek,
  getISOWeekYear,
  getQuarter,
  startOfDay,
  startOfMonth,
  startOfQuarter,
  startOfWeek,
  startOfYear,
} from 'date-fns'
import { fromZonedTime, toZonedTime } from 'date-fns-tz'
import { type SQL, sql } from 'drizzle-orm'
import type { DateGranularity } from '../../dashboards/client'

const CALENDAR_TRUNC: Partial<Record<DateGranularity, string>> = {
  day: 'day',
  week: 'week',
  month: 'month',
  quarter: 'quarter',
  year: 'year',
}

/** True for the cyclic granularities that bucket into a fixed 1..N key space. */
export function isCyclicGranularity(g: DateGranularity): boolean {
  return g === 'dayOfWeek' || g === 'monthOfYear'
}

/**
 * SQL expression producing the text bucket key for a timestamptz column in the
 * viewer's timezone. Calendar granularities emit the local bucket-start date
 * (`yyyy-MM-dd`); cyclic ones emit `'1'`-`'7'` (ISO dow) / `'1'`-`'12'`.
 */
export function bucketExpr(col: SQL, granularity: DateGranularity, timezone: string): SQL {
  if (granularity === 'dayOfWeek') {
    return sql`EXTRACT(ISODOW FROM ${col} AT TIME ZONE ${timezone})::int::text`
  }
  if (granularity === 'monthOfYear') {
    return sql`EXTRACT(MONTH FROM ${col} AT TIME ZONE ${timezone})::int::text`
  }
  const unit = CALENDAR_TRUNC[granularity] ?? 'day'
  return sql`to_char(date_trunc(${unit}, ${col} AT TIME ZONE ${timezone}), 'YYYY-MM-DD')`
}

/** Truncate a zone-local (naive) date to its bucket start. */
function truncateLocal(local: Date, granularity: DateGranularity): Date {
  switch (granularity) {
    case 'week':
      return startOfWeek(local, { weekStartsOn: 1 })
    case 'month':
      return startOfMonth(local)
    case 'quarter':
      return startOfQuarter(local)
    case 'year':
      return startOfYear(local)
    default:
      return startOfDay(local)
  }
}

/** Advance a zone-local bucket start to the next bucket start. */
function nextLocal(local: Date, granularity: DateGranularity): Date {
  switch (granularity) {
    case 'week':
      return addWeeks(local, 1)
    case 'month':
      return addMonths(local, 1)
    case 'quarter':
      return addQuarters(local, 1)
    case 'year':
      return addYears(local, 1)
    default:
      return addDays(local, 1)
  }
}

/** Parse a `yyyy-MM-dd` bucket key into a zone-local (naive) date. */
function parseKeyLocal(key: string): Date | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (!m) return undefined
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

/**
 * The UTC instant range `[from, to)` a calendar bucket key covers in the given
 * timezone. `undefined` for cyclic granularities (a "Mondays" bucket has no
 * contiguous range) and malformed keys — drill-down is unavailable there.
 */
export function bucketRange(
  key: string,
  granularity: DateGranularity,
  timezone: string
): { from: Date; to: Date } | undefined {
  if (isCyclicGranularity(granularity)) return undefined
  const local = parseKeyLocal(key)
  if (!local) return undefined
  return {
    from: fromZonedTime(local, timezone),
    to: fromZonedTime(nextLocal(local, granularity), timezone),
  }
}

/**
 * Enumerate every bucket key covering `[from, to)` in the viewer's timezone —
 * used to zero-fill missing buckets so chart axes stay continuous. Cyclic
 * granularities always yield the full 1..7 / 1..12 key space.
 */
export function enumerateBuckets(
  from: Date,
  to: Date,
  granularity: DateGranularity,
  timezone: string
): string[] {
  if (granularity === 'dayOfWeek') {
    return ['1', '2', '3', '4', '5', '6', '7']
  }
  if (granularity === 'monthOfYear') {
    return Array.from({ length: 12 }, (_, i) => String(i + 1))
  }

  const keys: string[] = []
  const endLocal = toZonedTime(to, timezone)
  let cursor = truncateLocal(toZonedTime(from, timezone), granularity)
  // Hard stop far above any sane chart axis; a pathological window can't spin.
  const MAX_BUCKETS = 1000
  while (cursor < endLocal && keys.length < MAX_BUCKETS) {
    keys.push(format(cursor, 'yyyy-MM-dd'))
    cursor = nextLocal(cursor, granularity)
  }
  return keys
}

const DOW_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

/** Display label for a bucket key: `2026-07`, `W27 2026`, `Q3 2026`, `Jul`, `Mon`, … */
export function formatBucketLabel(key: string, granularity: DateGranularity): string {
  if (granularity === 'dayOfWeek') return DOW_LABELS[Number(key) - 1] ?? key
  if (granularity === 'monthOfYear') return MONTH_LABELS[Number(key) - 1] ?? key

  const local = parseKeyLocal(key)
  if (!local) return key
  switch (granularity) {
    case 'week':
      return `W${getISOWeek(local)} ${getISOWeekYear(local)}`
    case 'month':
      return format(local, 'yyyy-MM')
    case 'quarter':
      return `Q${getQuarter(local)} ${format(local, 'yyyy')}`
    case 'year':
      return format(local, 'yyyy')
    default:
      return format(local, 'MMM d, yyyy')
  }
}
