// apps/web/src/components/mrp/ui/charts/position-chart-data.ts

import type { RouterOutputs } from '~/trpc/react'

export type PartSeriesData = RouterOutputs['mrp']['partSeries']
export type PartSeriesEvent = PartSeriesData['events'][number]

export type PositionWindow = '3m' | '6m' | '12m'
export type PositionGrain = 'day' | 'week' | 'month'

export const POSITION_WINDOWS: { value: PositionWindow; label: string }[] = [
  { value: '3m', label: '3 m' },
  { value: '6m', label: '6 m' },
  { value: '12m', label: '12 m' },
]

export const POSITION_GRAINS: { value: PositionGrain; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
]

/** Daily at 3 months, weekly at 6, monthly at 12 (07 §4.5). */
export function defaultGrain(window: PositionWindow): PositionGrain {
  return window === '3m' ? 'day' : window === '6m' ? 'week' : 'month'
}

/** One chart row per day; bucket values repeat over the bucket's days so a bar spans it. */
export interface PositionRow {
  day: string
  onHand: number | null
  projected: number | null
  bandLow: number | null
  /** `high − low`, stacked on `bandLow`. */
  bandSpan: number | null
  used: number | null
  projectedUse: number | null
  /** The bucket's last day, drawn with a gap after it. */
  bucketEnd: boolean
  stockout: boolean
  events: PartSeriesEvent[]
}

/** Joins history, projection and usage buckets on one daily axis. */
export function buildPositionRows(data: PartSeriesData): PositionRow[] {
  const rows = new Map<string, PositionRow>()
  const row = (day: string): PositionRow => {
    let r = rows.get(day)
    if (!r) {
      r = {
        day,
        onHand: null,
        projected: null,
        bandLow: null,
        bandSpan: null,
        used: null,
        projectedUse: null,
        bucketEnd: false,
        stockout: false,
        events: [],
      }
      rows.set(day, r)
    }
    return r
  }
  for (const d of data.days) {
    const r = row(d.day)
    r.onHand = d.onHandEod
    r.stockout = d.stockout
  }
  // The dashed line starts where the solid one ends.
  const last = data.days[data.days.length - 1]
  if (last && data.projection.length > 0) {
    const r = row(last.day)
    r.projected = last.onHandEod
    r.bandLow = last.onHandEod
    r.bandSpan = 0
  }
  for (const p of data.projection) {
    const r = row(p.day)
    r.projected = p.onHand
    r.bandLow = p.low
    r.bandSpan = p.high - p.low
  }

  const ordered = [...rows.values()].sort((a, b) => (a.day < b.day ? -1 : 1))
  const buckets = data.usage
  let b = -1
  for (const [i, r] of ordered.entries()) {
    while (b + 1 < buckets.length && (buckets[b + 1]?.bucket ?? '') <= r.day) b++
    const bucket = buckets[b]
    if (bucket) {
      const past = r.day < data.runAsOf
      r.used = past ? bucket.consumed : null
      r.projectedUse = past ? null : bucket.projected
    }
    const next = ordered[i + 1]
    const nextBucket = buckets[b + 1]
    r.bucketEnd =
      !next ||
      (nextBucket !== undefined && next.day >= nextBucket.bucket) ||
      next.day === data.runAsOf
  }

  const byDay = new Map(ordered.map((r) => [r.day, r]))
  for (const e of data.events) byDay.get(e.day)?.events.push(e)
  return ordered
}

/** Consecutive stockout days as `[from, to]` runs for shading. */
export function stockoutRuns(rows: readonly PositionRow[]): { from: string; to: string }[] {
  const runs: { from: string; to: string }[] = []
  let open: { from: string; to: string } | null = null
  for (const r of rows) {
    if (r.stockout) {
      if (open) open.to = r.day
      else open = { from: r.day, to: r.day }
    } else if (open) {
      runs.push(open)
      open = null
    }
  }
  if (open) runs.push(open)
  return runs
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** `2026-09-24` → `Sep 24`. */
export function formatDay(day: string): string {
  const month = MONTHS[Number(day.slice(5, 7)) - 1] ?? ''
  return `${month} ${Number(day.slice(8, 10))}`
}

/** Compact quantities for axes and labels. */
export function formatQty(value: number): string {
  return Math.abs(value) >= 1000
    ? `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`
    : `${Math.round(value * 10) / 10}`
}
