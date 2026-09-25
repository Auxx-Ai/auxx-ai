// packages/lib/src/mrp/run/seasonality.ts

import { addDaysToDayKey, type DayKey, daysBetween, endOfMonthDay } from '@auxx/utils/calendar-day'
import { mean } from '@auxx/utils/stats'
import { MRP_SEASONAL_MONTHS } from '../client'
import type { MonthlyBucket, SeasonalIndex, WhereUsedShare } from '../types'

export interface SeasonalIndexResult {
  /** Jan..Dec after shrinkage; null under the minimum clean months. */
  index: SeasonalIndex | null
  /** Clean months used (stockout months dropped). */
  months: number
  /** Shrinkage weight `months ÷ full`, capped at 1. */
  weight: number
}

const FLAT: SeasonalIndex = Array.from({ length: 12 }, () => 1)

/** 0-based calendar month of a day or month key. */
function monthOf(key: string): number {
  return Number(key.slice(5, 7)) - 1
}

/** A part's own index from its latest 24 months of `sold` (or `consumed`), shrunk towards 1 (02 §6.5 steps 1–2). */
export function computeSeasonalIndex(
  buckets: readonly MonthlyBucket[],
  measure: 'sold' | 'consumed' = 'sold'
): SeasonalIndexResult {
  const recent = [...buckets]
    .sort((a, b) => (a.month < b.month ? 1 : -1))
    .slice(0, MRP_SEASONAL_MONTHS.full)
    .filter((b) => b.stockoutDays === 0)
  const months = recent.length
  const weight = Math.min(1, months / MRP_SEASONAL_MONTHS.full)
  if (months < MRP_SEASONAL_MONTHS.min) return { index: null, months, weight }

  const byMonth: number[][] = Array.from({ length: 12 }, () => [])
  for (const b of recent) byMonth[monthOf(b.month)]?.push(b[measure])
  const monthAvg = byMonth.map((values) => mean(values))
  // The level is the mean of the calendar-month averages, so the index averages to 1 even with uneven coverage.
  const level = mean(monthAvg.filter((v): v is number => v !== null))
  if (!level) return { index: null, months, weight }

  const index = monthAvg.map((avg) => (avg === null ? 1 : 1 + weight * (avg / level - 1)))
  return { index, months, weight }
}

/** Every part's index: its own when nothing uses it, else the where-used-weighted blend of its parents' (02 §6.5 step 3). */
export function resolveSeasonalIndexes(
  ownIndexes: ReadonlyMap<string, SeasonalIndex | null>,
  shares: readonly WhereUsedShare[]
): Map<string, SeasonalIndex | null> {
  const sharesByPart = new Map<string, WhereUsedShare[]>()
  for (const share of shares) {
    if (share.quantity <= 0) continue
    const list = sharesByPart.get(share.partId) ?? []
    list.push(share)
    sharesByPart.set(share.partId, list)
  }

  const resolved = new Map<string, SeasonalIndex | null>()
  const visiting = new Set<string>()

  const resolve = (partId: string): SeasonalIndex | null => {
    if (resolved.has(partId)) return resolved.get(partId) ?? null
    const own = ownIndexes.get(partId) ?? null
    const partShares = sharesByPart.get(partId)
    if (visiting.has(partId)) return own
    if (!partShares) {
      resolved.set(partId, own)
      return own
    }
    visiting.add(partId)

    let total = 0
    let anyIndex = false
    const blended = Array.from({ length: 12 }, () => 0)
    for (const share of partShares) {
      const parentIndex = share.parentId === partId ? own : resolve(share.parentId)
      if (parentIndex) anyIndex = true
      const source = parentIndex ?? FLAT
      for (let m = 0; m < 12; m++)
        blended[m] = (blended[m] ?? 0) + share.quantity * (source[m] ?? 1)
      total += share.quantity
    }
    visiting.delete(partId)
    const result = anyIndex && total > 0 ? blended.map((v) => v / total) : null
    resolved.set(partId, result)
    return result
  }

  for (const partId of new Set([...ownIndexes.keys(), ...sharesByPart.keys()])) resolve(partId)
  return resolved
}

/** The half-open range `[from, to)` split at month boundaries, as `{ month, days }` runs. */
function monthRuns(from: DayKey, to: DayKey): { month: number; days: number }[] {
  const runs: { month: number; days: number }[] = []
  let cursor = from
  let remaining = daysBetween(from, to) ?? 0
  while (remaining > 0) {
    const toMonthEnd = (daysBetween(cursor, endOfMonthDay(cursor)) ?? 0) + 1
    const days = Math.min(remaining, toMonthEnd)
    runs.push({ month: monthOf(cursor), days })
    cursor = addDaysToDayKey(cursor, days)
    remaining -= days
  }
  return runs
}

/** Mean index over the days of `[from, to)`; 1 when the index is off or the range is empty. */
export function averageIndexOver(index: SeasonalIndex | null, from: DayKey, to: DayKey): number {
  if (!index) return 1
  const runs = monthRuns(from, to)
  const days = runs.reduce((sum, r) => sum + r.days, 0)
  if (days === 0) return 1
  return runs.reduce((sum, r) => sum + r.days * (index[r.month] ?? 1), 0) / days
}

/** ADU with the season taken out: trailing ADU ÷ the mean index over the trailing window `[from, to)` (step 4). */
export function computeBaseAdu(
  adu: number,
  index: SeasonalIndex | null,
  windowFrom: DayKey,
  windowTo: DayKey
): number {
  const avg = averageIndexOver(index, windowFrom, windowTo)
  return avg > 0 ? adu / avg : adu
}

/** Usage over `[from, to)`: Σ over its days of `baseAdu × index(month)` (step 5). */
export function projectUsage(
  baseAdu: number,
  index: SeasonalIndex | null,
  from: DayKey,
  to: DayKey
): number {
  let total = 0
  for (const run of monthRuns(from, to)) total += run.days * baseAdu * (index?.[run.month] ?? 1)
  return total
}

/** The daily rate on `day`. */
export function rateOnDay(baseAdu: number, index: SeasonalIndex | null, day: DayKey): number {
  return baseAdu * (index?.[monthOf(day)] ?? 1)
}
