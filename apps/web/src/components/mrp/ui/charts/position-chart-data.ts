// apps/web/src/components/mrp/ui/charts/position-chart-data.ts

import type { RouterOutputs } from '~/trpc/react'

type PartSeriesData = RouterOutputs['mrp']['partSeries']
export type PartSeriesEvent = PartSeriesData['events'][number]

/** A stack key: one variant, or `'other'` folding the tail (plan 15 D40). */
export interface SeriesKey {
  key: string
  name: string
  partIds: string[]
}

/** `mrp.partSeries` or `mrp.productSeries`; a part carries no `series` and no per-key arrays. */
export interface SeriesData extends Omit<PartSeriesData, 'days' | 'usage'> {
  /** Stack keys, bottom first; `...ByKey[i]` ↔ `series[i]`. */
  series?: SeriesKey[]
  days: Array<PartSeriesData['days'][number] & { onHandByKey?: number[] }>
  usage: Array<PartSeriesData['usage'][number] & { consumedByKey?: number[] }>
}

/** True when the data stacks by variant. */
export function hasSeries(data: SeriesData): boolean {
  return (data.series?.length ?? 0) > 0
}

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

/** Day grain draws a bar per day, too thin to read and too heavy to render past 3 months. */
export function grainAllowed(grain: PositionGrain, window: PositionWindow): boolean {
  return grain !== 'day' || window === '3m'
}

/** Daily at 3 months, weekly at 6, monthly at 12 (07 §4.5). */
export function defaultGrain(window: PositionWindow): PositionGrain {
  return window === '3m' ? 'day' : window === '6m' ? 'week' : 'month'
}

/** One chart row per day; bucket values repeat over the bucket's days so a bar spans it. */
export interface PositionRow {
  day: string
  /** Days since 1970-01-01, the chart's numeric x. */
  t: number
  onHand: number | null
  projected: number | null
  bandLow: number | null
  /** `high − low`, stacked on `bandLow`. */
  bandSpan: number | null
  used: number | null
  projectedUse: number | null
  /** Per stack key, floored at zero; null for a part or a projected day. */
  onHandByKey: number[] | null
  /** Per stack key, the bucket's past usage; null for a part or a projected day. */
  usedByKey: number[] | null
  /** The bucket's last day, drawn with a gap after it. */
  bucketEnd: boolean
  stockout: boolean
  events: PartSeriesEvent[]
}

/** Joins history, projection and usage buckets on one daily axis. */
export function buildPositionRows(data: SeriesData): PositionRow[] {
  const keyed = hasSeries(data)
  const rows = new Map<string, PositionRow>()
  const row = (day: string): PositionRow => {
    let r = rows.get(day)
    if (!r) {
      r = {
        day,
        t: dayToT(day),
        onHand: null,
        projected: null,
        bandLow: null,
        bandSpan: null,
        used: null,
        projectedUse: null,
        onHandByKey: null,
        usedByKey: null,
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
    if (keyed) r.onHandByKey = d.onHandByKey ?? null
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
      if (keyed && past) r.usedByKey = bucket.consumedByKey ?? null
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

/** One usage bar: a bucket's days on one side of the run day. */
export interface UsageSpan {
  from: string
  to: string
  value: number
  projected: boolean
  /** Per stack key, stacked bottom first; absent for a part or a projected bar. */
  byKey?: number[]
}

/** Collapses the per-day usage values into one span per bar, so a year draws ~25 rects, not ~750. */
export function usageSpans(rows: readonly PositionRow[]): UsageSpan[] {
  const spans: UsageSpan[] = []
  let open: UsageSpan | null = null
  for (const r of rows) {
    const value = r.used ?? r.projectedUse
    if (value === null) {
      open = null
      continue
    }
    if (open) open.to = r.day
    else {
      open = { from: r.day, to: r.day, value, projected: r.used === null }
      if (r.usedByKey) open.byKey = r.usedByKey
      spans.push(open)
    }
    if (r.bucketEnd) open = null
  }
  return spans.filter((s) => s.value > 0)
}

const DAY_MS = 86_400_000

/** `2026-09-24` → days since the epoch. */
export function dayToT(day: string): number {
  return (
    Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))) /
    DAY_MS
  )
}

/** Inverse of `dayToT`. */
export function tToDay(t: number): string {
  return new Date(Math.round(t) * DAY_MS).toISOString().slice(0, 10)
}

/** `[lo, hi]` covering every row's `t`, padded half a day so edge bars sit inside the plot. */
export function xExtent(rows: readonly PositionRow[]): [number, number] {
  const first = rows[0]?.t ?? 0
  const last = rows[rows.length - 1]?.t ?? first
  return [first - 0.5, last + 0.5]
}

/**
 * At most `max` x ticks on a day grid anchored to the epoch, so the same days stay
 * ticked while the window pages and the labels scroll instead of re-phasing.
 */
export function xTicks(lo: number, hi: number, max: number): number[] {
  const days = Math.max(1, Math.round(hi - lo))
  const step = Math.max(1, Math.ceil(days / max))
  const out: number[] = []
  for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) out.push(t + 0)
  return out
}

/** Whole-number ticks on a 1/2/5 step, from the floor of `min` to the ceiling of `max`. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (max <= min) max = min + 1
  const raw = (max - min) / Math.max(1, count - 1)
  const mag = 10 ** Math.floor(Math.log10(raw))
  const norm = raw / mag
  // d3's thresholds: √50, √10, √2.
  const step = Math.max(1, (norm >= 7.07 ? 10 : norm >= 3.16 ? 5 : norm >= 1.41 ? 2 : 1) * mag)
  const lo = Math.floor(min / step) * step
  const hi = Math.ceil(max / step) * step
  const out: number[] = []
  for (let v = lo; v <= hi + step / 2; v += step) out.push(Math.round(v * 1e6) / 1e6)
  return out
}

/** The left axis covers on hand, stacked areas, band and zones; the right covers usage. */
export function yExtents(
  rows: readonly PositionRow[],
  zoneTop: number | null
): { left: [number, number]; right: [number, number] } {
  let lo = 0
  let hi = zoneTop ?? 0
  let usage = 0
  for (const r of rows) {
    for (const v of [r.onHand, r.projected, r.bandLow]) {
      if (v === null) continue
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
    if (r.bandLow !== null && r.bandSpan !== null && r.bandLow + r.bandSpan > hi) {
      hi = r.bandLow + r.bandSpan
    }
    // Floored slices can stack above a negative true sum.
    if (r.onHandByKey) {
      const stacked = r.onHandByKey.reduce((a, v) => a + v, 0)
      if (stacked > hi) hi = stacked
    }
    const u = r.used ?? r.projectedUse
    if (u !== null && u > usage) usage = u
    // StackedBar skips segments at or below zero, so they add no height.
    if (r.usedByKey) {
      const stacked = r.usedByKey.reduce((a, v) => a + Math.max(0, v), 0)
      if (stacked > usage) usage = stacked
    }
  }
  const left = niceTicks(lo, Math.max(hi, 1))
  const right = niceTicks(0, Math.max(usage, 1))
  return {
    left: [left[0] ?? 0, left[left.length - 1] ?? 1],
    right: [0, right[right.length - 1] ?? 1],
  }
}

/** The union of two windows' rows on one axis, `next` winning where days overlap. */
export function mergeRows(
  prev: readonly PositionRow[],
  next: readonly PositionRow[]
): PositionRow[] {
  const byDay = new Map<string, PositionRow>()
  for (const r of prev) byDay.set(r.day, r)
  for (const r of next) byDay.set(r.day, r)
  return [...byDay.values()].sort((a, b) => a.t - b.t)
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** `2026-09-24` → `Sep 24`. */
export function formatDay(day: string): string {
  const month = MONTHS[Number(day.slice(5, 7)) - 1] ?? ''
  return `${month} ${Number(day.slice(8, 10))}`
}

/** `2026-09-24` → `Sep 2026`. */
export function formatMonth(day: string): string {
  return `${MONTHS[Number(day.slice(5, 7)) - 1] ?? ''} ${day.slice(0, 4)}`
}

/** Compact quantities for axes and labels. */
export function formatQty(value: number): string {
  return Math.abs(value) >= 1000
    ? `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`
    : `${Math.round(value * 10) / 10}`
}
