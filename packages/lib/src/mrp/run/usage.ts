// packages/lib/src/mrp/run/usage.ts

import { mean, median, stddev } from '@auxx/utils/stats'
import { MRP_BATCH_BUILD_RATIO, MRP_MAX_STOCKOUT_SHARE, MRP_SOLD_FROM_SHELF_SHARE } from '../client'
import type { DailyActivity, DailySeriesPoint } from '../types'

export interface UsageStats {
  /** Average daily usage over the uncensored days; null when every day was censored. */
  adu: number | null
  /** Population σ of daily usage over the same days. */
  sigma: number | null
  /** σ ÷ ADU; null at ADU 0. */
  cv: number | null
  /** Days that counted towards ADU. */
  observedDays: number
  stockoutDaysExcluded: number
  totalUsage: number
  /** Days that ended below zero: missing movements, not an empty shelf. */
  negativeDays: number
  /** Stockouts passed `MRP_MAX_STOCKOUT_SHARE`, so every day counted towards ADU. */
  censorCapped: boolean
}

/** A stockout day: the shelf ended empty and nothing was consumed, so zero use is not zero demand. */
export function isStockoutDay(point: DailySeriesPoint): boolean {
  // Below zero is a ledger gap, not an empty shelf; censoring it would inflate ADU.
  return Math.abs(point.onHandEod) < 1e-9 && point.consumed + point.scrapped === 0
}

/** ADU, σ and CV for one part's dense daily series; scrap counts as usage (01 §2). */
export function computeUsage(points: readonly DailySeriesPoint[]): UsageStats {
  const all: number[] = []
  const inStock: number[] = []
  let excluded = 0
  let negativeDays = 0
  for (const point of points) {
    const used = point.consumed + point.scrapped
    all.push(used)
    if (point.onHandEod < 0) negativeDays++
    if (isStockoutDay(point)) excluded++
    else inStock.push(used)
  }
  const censorCapped = points.length > 0 && excluded / points.length > MRP_MAX_STOCKOUT_SHARE
  const daily = censorCapped ? all : inStock
  const adu = mean(daily)
  const sigma = stddev(daily)
  return {
    adu,
    sigma,
    cv: adu && sigma !== null ? sigma / adu : null,
    observedDays: daily.length,
    stockoutDaysExcluded: censorCapped ? 0 : excluded,
    totalUsage: daily.reduce((sum, v) => sum + v, 0),
    negativeDays,
    censorCapped,
  }
}

export interface ShelfSignals {
  saleDays: number
  /** Sale days with no `build_produce` the same book-zone day (Q9). */
  saleDaysWithoutBuild: number
  /** `saleDaysWithoutBuild ÷ saleDays`; null with no sales. */
  soldFromShelfShare: number | null
  soldFromShelf: boolean
  /** Median over produce days of quantity per `build_produce` row. */
  typicalProduceQty: number | null
  /** Median over use days of quantity per sale or consume row. */
  typicalUseQty: number | null
  batchBuilt: boolean
}

/** The sold-from-shelf and batch-build signals 02 §8 reads, from one part's daily activity. */
export function computeShelfSignals(activity: readonly DailyActivity[]): ShelfSignals {
  let saleDays = 0
  let saleDaysWithoutBuild = 0
  const producePerRow: number[] = []
  const usePerRow: number[] = []
  for (const day of activity) {
    if (day.saleQty > 0) {
      saleDays++
      if (day.produceQty <= 0) saleDaysWithoutBuild++
    }
    if (day.produceQty > 0 && day.produceCount > 0) {
      producePerRow.push(day.produceQty / day.produceCount)
    }
    const useCount = day.saleCount + day.consumeCount
    if (useCount > 0) usePerRow.push((day.saleQty + day.consumeQty) / useCount)
  }
  const share = saleDays > 0 ? saleDaysWithoutBuild / saleDays : null
  const typicalProduceQty = median(producePerRow)
  const typicalUseQty = median(usePerRow)
  return {
    saleDays,
    saleDaysWithoutBuild,
    soldFromShelfShare: share,
    soldFromShelf: share !== null && share > MRP_SOLD_FROM_SHELF_SHARE,
    typicalProduceQty,
    typicalUseQty,
    batchBuilt:
      typicalProduceQty !== null &&
      typicalUseQty !== null &&
      typicalUseQty > 0 &&
      typicalProduceQty >= MRP_BATCH_BUILD_RATIO * typicalUseQty,
  }
}
