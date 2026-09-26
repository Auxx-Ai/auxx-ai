// apps/web/src/components/mrp/ui/charts/delivery-record-data.ts

import type { MrpObservationExclusion } from '@auxx/lib/mrp/client'
import { median } from '@auxx/utils/stats'
import type { RouterOutputs } from '~/trpc/react'
import { dayToT, niceTicks } from './position-chart-data'

export type SupplierPerformanceData = RouterOutputs['mrp']['supplierPerformance']

/** Plan Q36: the rolling median runs over observations, not days. */
export const ROLLING_MEDIAN_WINDOW = 8

export type DeliveryPointKind = 'on_time' | 'late' | 'excluded'

/** One PO line on the plot; excluded lines sit at y = 0. */
export interface DeliveryPoint {
  key: string
  /** `orderedAt` in epoch days. */
  t: number
  /** Receipt day − expected day; 0 for excluded lines. */
  lateness: number
  kind: DeliveryPointKind
  purchaseOrderId: string
  purchaseOrderName: string | null
  partName: string | null
  partSku: string | null
  orderedAt: string
  expectedAt: string | null
  lastReceivedAt: string | null
  leadTimeDays: number | null
  fill: number | null
  excludedReason: MrpObservationExclusion | null
}

export interface DeliveryRecord {
  /** Clean observations with an expected date, ordered by `t`. */
  clean: DeliveryPoint[]
  excluded: DeliveryPoint[]
  /** One rolling-median value per clean point. */
  median: { t: number; value: number }[]
  /** Clean observations without an expected date: counted, not plotted (plan D40). */
  noExpected: number
}

/** Flattens every vendor part's lines into plot points. */
export function buildDeliveryRecord(data: SupplierPerformanceData): DeliveryRecord {
  const clean: DeliveryPoint[] = []
  const excluded: DeliveryPoint[] = []
  let noExpected = 0
  for (const vp of data.vendorParts) {
    for (const line of vp.lines) {
      const base = {
        key: line.purchaseOrderLineId,
        purchaseOrderId: line.purchaseOrderId,
        purchaseOrderName: line.purchaseOrderName,
        partName: vp.partName,
        partSku: vp.partSku,
        expectedAt: line.expectedAt,
        lastReceivedAt: line.lastReceivedAt,
      }
      const obs = line.observation
      if (obs) {
        if (obs.latenessDays === null) noExpected++
        else if (line.orderedAt) {
          clean.push({
            ...base,
            t: dayToT(line.orderedAt),
            orderedAt: line.orderedAt,
            lateness: obs.latenessDays,
            kind: obs.latenessDays <= 0 ? 'on_time' : 'late',
            leadTimeDays: obs.leadTimeDays,
            fill: obs.fill,
            excludedReason: null,
          })
        }
        continue
      }
      // `not_received` is an open or short-closed line, not paperwork; the stats skip it too.
      if (line.excludedReason && line.excludedReason !== 'not_received' && line.orderedAt) {
        excluded.push({
          ...base,
          t: dayToT(line.orderedAt),
          orderedAt: line.orderedAt,
          lateness: 0,
          kind: 'excluded',
          leadTimeDays: null,
          fill: null,
          excludedReason: line.excludedReason,
        })
      }
    }
  }
  const byT = (a: DeliveryPoint, b: DeliveryPoint) =>
    a.t - b.t || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
  clean.sort(byT)
  excluded.sort(byT)
  const values = rollingMedian(clean.map((p) => p.lateness))
  return {
    clean,
    excluded,
    median: clean.map((p, i) => ({ t: p.t, value: values[i] ?? 0 })),
    noExpected,
  }
}

/** Median of each value with up to `window − 1` values before it. */
export function rollingMedian(values: readonly number[], window = ROLLING_MEDIAN_WINDOW): number[] {
  return values.map((_, i) => median(values.slice(Math.max(0, i - window + 1), i + 1)) ?? 0)
}

/** `[xLo, xHi, yLo, yHi]`: x padded half a day, y on nice ticks and always including 0. */
export function deliveryExtents(record: DeliveryRecord): [number, number, number, number] {
  const points = [...record.clean, ...record.excluded]
  let tLo = Number.POSITIVE_INFINITY
  let tHi = Number.NEGATIVE_INFINITY
  let yLo = 0
  let yHi = 0
  for (const p of points) {
    if (p.t < tLo) tLo = p.t
    if (p.t > tHi) tHi = p.t
    if (p.lateness < yLo) yLo = p.lateness
    if (p.lateness > yHi) yHi = p.lateness
  }
  if (points.length === 0) tLo = tHi = 0
  const y = niceTicks(yLo, yHi)
  return [tLo - 0.5, tHi + 0.5, y[0] ?? 0, y[y.length - 1] ?? 1]
}

/** `+4 d`, `−3 d`, `0 d`; halves survive, since a median of an even count lands on one. */
export function formatLateness(days: number): string {
  const v = Math.round(days * 10) / 10
  if (v === 0) return '0 d'
  return v > 0 ? `+${v} d` : `−${-v} d`
}
