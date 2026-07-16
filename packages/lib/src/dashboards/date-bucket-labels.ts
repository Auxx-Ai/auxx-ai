// packages/lib/src/dashboards/date-bucket-labels.ts
//
// CLIENT-SAFE date-bucket label formatting (plan 10). Pure (date-fns only, no
// drizzle) so BOTH the server (`resources/aggregate/date-buckets.ts`, which
// re-exports these) and the chart widgets can format a raw bucket key the same
// way. The raw key round-trips in the aggregate result (`AggregateGroup.key`),
// so the category-axis label is a pure function of (key, granularity, format) —
// no re-query needed to restyle it.
//
// Calendar keys are the local bucket-start date `yyyy-MM-dd`; cyclic keys are
// `'1'`-`'7'` (ISO dow) / `'1'`-`'12'`. Keep this in lockstep with the SQL bucket
// expressions in `date-buckets.ts`.

import { format as formatDate, getISOWeek, getISOWeekYear, getQuarter } from 'date-fns'
import type { DateGranularity } from './client'

/**
 * Optional display style for a date bucket label, layered over the DEFAULT
 * (undefined) which reproduces the historical server labels exactly:
 * - `short`  → `Jul 2026`, `Jul 7`, `Monday`→`Mon`
 * - `long`   → `July 2026`, `July 7, 2026`, `Monday`
 * - `iso`    → sortable numerics: `2026-07`, `2026-W27`, `2026-Q3`, `2026-07-07`
 */
export type DateLabelFormat = 'short' | 'long' | 'iso'

const DOW_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const DOW_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
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
const MONTH_LONG = [
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
]

/** Parse a `yyyy-MM-dd` bucket key into a zone-local (naive) date. */
export function parseKeyLocal(key: string): Date | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (!m) return undefined
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

/**
 * Pick a smarter DEFAULT label style from the actual bucket keys on the axis.
 * Day buckets that all fall in one calendar year drop the redundant year
 * (`Jul 10` instead of `Jul 10, 2026` repeated across every tick). Only
 * consulted when the widget has NO explicit `labelFormat` override; every
 * other granularity keeps its historical default.
 */
export function resolveDefaultDateLabelFormat(
  keys: Array<string | null>,
  granularity: DateGranularity
): DateLabelFormat | undefined {
  if (granularity !== 'day') return undefined
  let year: string | undefined
  for (const key of keys) {
    if (key === null) continue
    const m = /^(\d{4})-\d{2}-\d{2}$/.exec(key)
    if (!m) return undefined
    if (year === undefined) year = m[1]
    else if (m[1] !== year) return undefined
  }
  return year === undefined ? undefined : 'short'
}

/**
 * Display label for a bucket key. `format` undefined ⇒ the historical default
 * (`2026-07`, `W27 2026`, `Q3 2026`, `Jul`, `Mon`, `Jul 7, 2026`). An explicit
 * `format` restyles per granularity; styles that don't differ for a granularity
 * fall back to the default.
 */
export function formatBucketLabel(
  key: string,
  granularity: DateGranularity,
  format?: DateLabelFormat
): string {
  if (granularity === 'dayOfWeek') {
    const i = Number(key) - 1
    return (format === 'long' ? DOW_LONG[i] : DOW_LABELS[i]) ?? key
  }
  if (granularity === 'monthOfYear') {
    const i = Number(key) - 1
    return (format === 'long' ? MONTH_LONG[i] : MONTH_LABELS[i]) ?? key
  }

  const local = parseKeyLocal(key)
  if (!local) return key

  switch (granularity) {
    case 'week': {
      const week = getISOWeek(local)
      const year = getISOWeekYear(local)
      if (format === 'iso') return `${year}-W${String(week).padStart(2, '0')}`
      if (format === 'long') return `Week ${week}, ${year}`
      return `W${week} ${year}`
    }
    case 'month':
      if (format === 'short') return formatDate(local, 'MMM yyyy')
      if (format === 'long') return formatDate(local, 'MMMM yyyy')
      return formatDate(local, 'yyyy-MM')
    case 'quarter': {
      const q = getQuarter(local)
      if (format === 'iso') return `${formatDate(local, 'yyyy')}-Q${q}`
      return `Q${q} ${formatDate(local, 'yyyy')}`
    }
    case 'year':
      return formatDate(local, 'yyyy')
    default:
      if (format === 'iso') return formatDate(local, 'yyyy-MM-dd')
      if (format === 'long') return formatDate(local, 'MMMM d, yyyy')
      if (format === 'short') return formatDate(local, 'MMM d')
      return formatDate(local, 'MMM d, yyyy')
  }
}
