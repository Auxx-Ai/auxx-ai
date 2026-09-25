// packages/lib/src/mrp/reads/part-series-projection.ts

import {
  addDaysToDayKey,
  type DayKey,
  daysBetween,
  startOfMonthDay,
} from '@auxx/utils/calendar-day'
import { rateOnDay } from '../run/seasonality'
import type { SeasonalIndex } from '../types'

export const PART_SERIES_WINDOWS = ['3m', '6m', '12m'] as const
export type PartSeriesWindow = (typeof PART_SERIES_WINDOWS)[number]
export const PART_SERIES_GRAINS = ['day', 'week', 'month'] as const
export type PartSeriesGrain = (typeof PART_SERIES_GRAINS)[number]

export const PART_SERIES_WINDOW_MONTHS: Record<PartSeriesWindow, number> = {
  '3m': 3,
  '6m': 6,
  '12m': 12,
}

/** The projection runs at least this far past the run day (07 §5.1). */
export const PROJECTION_MIN_DAYS = 90
/** Upper bound on the projection, whatever the following arrival says. */
export const PROJECTION_MAX_DAYS = 400
/** ~90 % two-sided normal quantile for the uncertainty band. */
export const BAND_Z = 1.645

/** One bucket at the chosen grain; `bucket` is its first day (Monday for weeks). */
export interface PartSeriesUsageBucket {
  bucket: DayKey
  /** Consumed on past days in the bucket; null when the bucket is wholly in the future. */
  consumed: number | null
  /** Σ `baseAdu × index` over the bucket's future days; null when wholly in the past. */
  projected: number | null
  /** Stockout days in the bucket, where `consumed` understates demand. */
  stockoutDays: number
}

export interface PartSeriesProjectionPoint {
  day: DayKey
  /** Projected end-of-day on hand, floored at 0. */
  onHand: number
  low: number
  high: number
}

/** A projected day plus the usage it assumed, for bucketing. */
export interface ProjectionWalkPoint extends PartSeriesProjectionPoint {
  used: number
}

export interface ProjectionWalkInput {
  fromDay: DayKey
  toDay: DayKey
  /** On hand at the start of `fromDay`, less open demand. */
  onHand: number
  receipts: readonly { day: DayKey; quantity: number }[]
  baseAdu: number
  seasonalIndex: SeasonalIndex | null
  /** Daily usage standard deviation; null draws no band. */
  sigma: number | null
  /** The band stops widening at the lead time; null never caps. */
  leadTimeDays: number | null
}

/** First day of the bucket holding `day`. */
export function bucketStart(day: DayKey, grain: PartSeriesGrain): DayKey {
  if (grain === 'day') return day
  if (grain === 'month') return startOfMonthDay(day)
  const [y, m, d] = day.split('-').map(Number)
  const weekday = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).getUTCDay()
  return addDaysToDayKey(day, -((weekday + 6) % 7))
}

/** Last projected day: the later of `fromDay + 90` and the following arrival, capped. */
export function projectionEndDay(fromDay: DayKey, followingArrival: DayKey | null): DayKey {
  const min = addDaysToDayKey(fromDay, PROJECTION_MIN_DAYS)
  const max = addDaysToDayKey(fromDay, PROJECTION_MAX_DAYS)
  const end = followingArrival && followingArrival > min ? followingArrival : min
  return end > max ? max : end
}

/** Band half-width after `daysAhead` days of usage: z·σ·√min(daysAhead, lead time). */
export function bandHalfWidth(
  sigma: number | null,
  daysAhead: number,
  leadTimeDays: number | null
): number {
  if (!sigma || sigma <= 0 || daysAhead <= 0) return 0
  const horizon =
    leadTimeDays !== null && leadTimeDays > 0 ? Math.min(daysAhead, leadTimeDays) : daysAhead
  return BAND_Z * sigma * Math.sqrt(horizon)
}

const round = (n: number) => Math.round(n * 100) / 100

/** Walks daily from `fromDay` to `toDay`: receipts land at the start of their day, usage at `baseAdu × index`. */
export function walkProjection(input: ProjectionWalkInput): ProjectionWalkPoint[] {
  const span = daysBetween(input.fromDay, input.toDay)
  if (span === null || span < 0) return []
  const landing = new Map<number, number>()
  for (const r of input.receipts) {
    const offset = Math.max(0, daysBetween(input.fromDay, r.day) ?? 0)
    if (offset <= span) landing.set(offset, (landing.get(offset) ?? 0) + r.quantity)
  }
  const points: ProjectionWalkPoint[] = []
  let level = input.onHand
  for (let t = 0; t <= span; t++) {
    const day = addDaysToDayKey(input.fromDay, t)
    const used = Math.max(0, rateOnDay(input.baseAdu, input.seasonalIndex, day))
    level += (landing.get(t) ?? 0) - used
    const half = bandHalfWidth(input.sigma, t + 1, input.leadTimeDays)
    points.push({
      day,
      onHand: round(Math.max(0, level)),
      low: round(Math.max(0, level - half)),
      high: round(Math.max(0, level + half)),
      used,
    })
  }
  return points
}

/** Past days' consumption and future days' projected use, summed per bucket in day order. */
export function bucketUsage(
  past: readonly { day: DayKey; consumed: number; stockout: boolean }[],
  future: readonly { day: DayKey; used: number }[],
  grain: PartSeriesGrain
): PartSeriesUsageBucket[] {
  const buckets = new Map<DayKey, PartSeriesUsageBucket>()
  const at = (day: DayKey) => {
    const key = bucketStart(day, grain)
    let b = buckets.get(key)
    if (!b) {
      b = { bucket: key, consumed: null, projected: null, stockoutDays: 0 }
      buckets.set(key, b)
    }
    return b
  }
  for (const d of past) {
    const b = at(d.day)
    b.consumed = (b.consumed ?? 0) + d.consumed
    if (d.stockout) b.stockoutDays++
  }
  for (const d of future) {
    const b = at(d.day)
    b.projected = (b.projected ?? 0) + d.used
  }
  return [...buckets.values()]
    .map((b) => ({
      ...b,
      consumed: b.consumed === null ? null : round(b.consumed),
      projected: b.projected === null ? null : round(b.projected),
    }))
    .sort((a, b) => (a.bucket < b.bucket ? -1 : a.bucket > b.bucket ? 1 : 0))
}
