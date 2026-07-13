// apps/web/src/components/dispatch/utils/date-ranges.ts
//
// Day-granular `YYYY-MM-DD` interval algebra for the availability cache (12-availability-cache.md
// §A). ISO date strings compare lexicographically = chronologically, so ordering is plain string
// compare; only adjacency/step needs real date math.

import { addDays, format, parseISO } from 'date-fns'

export interface DateRange {
  /** inclusive `YYYY-MM-DD` */
  from: string
  /** inclusive `YYYY-MM-DD` */
  to: string
}

const step = (d: string, delta: number): string => format(addDays(parseISO(d), delta), 'yyyy-MM-dd')
const nextDay = (d: string): string => step(d, 1)
const prevDay = (d: string): string => step(d, -1)

/** Inclusive day count of a range (1 for a single-day range). */
export function daySpan(range: DateRange): number {
  return (
    Math.round((parseISO(range.to).getTime() - parseISO(range.from).getTime()) / 86_400_000) + 1
  )
}

/** Merge overlapping OR adjacent ranges. Input need not be sorted. */
export function coalesce(ranges: DateRange[]): DateRange[] {
  if (ranges.length <= 1) return ranges.map((r) => ({ ...r }))
  const sorted = [...ranges].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0))
  const out: DateRange[] = [{ ...sorted[0]! }]
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]!
    const last = out[out.length - 1]!
    // overlap or adjacency: cur starts on or before the day after last.to
    if (cur.from <= nextDay(last.to)) {
      if (cur.to > last.to) last.to = cur.to
    } else {
      out.push({ ...cur })
    }
  }
  return out
}

/** The sub-ranges of `want` NOT covered by `have` (the gaps to fetch). `have` is coalesced here. */
export function subtractRanges(want: DateRange, have: DateRange[]): DateRange[] {
  const covered = coalesce(have).filter((r) => r.to >= want.from && r.from <= want.to)
  const gaps: DateRange[] = []
  let cursor = want.from
  for (const r of covered) {
    if (r.from > cursor) gaps.push({ from: cursor, to: prevDay(r.from) })
    if (r.to >= cursor) cursor = nextDay(r.to)
    if (cursor > want.to) break
  }
  if (cursor <= want.to) gaps.push({ from: cursor, to: want.to })
  return gaps
}

/** Split a range into pieces of at most `maxDays` — `availability.resolve` hard-caps at 366 days. */
export function chunkRange(range: DateRange, maxDays: number): DateRange[] {
  if (daySpan(range) <= maxDays) return [range]
  const out: DateRange[] = []
  let start = range.from
  while (start <= range.to) {
    const end = step(start, maxDays - 1)
    const clamped = end < range.to ? end : range.to
    out.push({ from: start, to: clamped })
    start = nextDay(clamped)
  }
  return out
}
