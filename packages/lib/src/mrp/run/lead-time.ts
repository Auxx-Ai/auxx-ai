// packages/lib/src/mrp/run/lead-time.ts

import { type DayKey, daysBetween } from '@auxx/utils/calendar-day'
import { mean, median, percentile } from '@auxx/utils/stats'
import {
  MRP_DRIFT_MIN_DAYS,
  MRP_DRIFT_MIN_SHARE,
  MRP_MIN_RECEIPTS,
  MRP_RECEIVED_SHARE_FOR_LEAD_TIME,
  type MrpLeadTimeSource,
  type MrpObservationExclusion,
  type MrpSupplyType,
} from '../client'
import type { PartInput, ReceiptObservation, VendorPartInput } from '../types'

export interface SupplyClassification {
  supplyType: MrpSupplyType
  /** True when `part_cost_source` was `none`/empty and structure decided (D12). */
  structural: boolean
}

/** Bought vs made from `part_cost_source`, falling back to structure on `none` (D12). */
export function classifySupply(
  part: Pick<PartInput, 'costSource' | 'hasVendorPart' | 'hasBomChildren'>
): SupplyClassification {
  if (part.costSource === 'vendor') return { supplyType: 'bought', structural: false }
  if (part.costSource === 'bom') return { supplyType: 'made', structural: false }
  if (part.hasVendorPart) return { supplyType: 'bought', structural: true }
  if (part.hasBomChildren) return { supplyType: 'made', structural: true }
  return { supplyType: 'unclassified', structural: true }
}

/** Q8: the preferred vendor part, else the shortest stated lead time, ties by id. */
export function pickPreferredVendorPart(
  vendorParts: readonly VendorPartInput[]
): VendorPartInput | null {
  const preferred = vendorParts.filter((vp) => vp.isPreferred)
  const pool = preferred.length > 0 ? preferred : vendorParts
  return (
    [...pool].sort((a, b) => {
      const la = a.leadTimeDays ?? Number.POSITIVE_INFINITY
      const lb = b.leadTimeDays ?? Number.POSITIVE_INFINITY
      return la !== lb ? la - lb : a.id < b.id ? -1 : 1
    })[0] ?? null
  )
}

export interface StatedLeadTime {
  leadTimeDays: number | null
  source: MrpLeadTimeSource
}

/** The stated lead time (D11): bought → the vendor part's, made → `part_build_lead_time_days`, else none. */
export function resolveStatedLeadTime(
  part: Pick<PartInput, 'buildLeadTimeDays'>,
  supplyType: MrpSupplyType,
  vendorPart: Pick<VendorPartInput, 'leadTimeDays'> | null
): StatedLeadTime {
  const valid = (v: number | null | undefined): v is number =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0
  if (supplyType === 'bought' && valid(vendorPart?.leadTimeDays)) {
    return { leadTimeDays: vendorPart.leadTimeDays, source: 'vendor' }
  }
  if (supplyType === 'made' && valid(part.buildLeadTimeDays)) {
    return { leadTimeDays: part.buildLeadTimeDays, source: 'build' }
  }
  return { leadTimeDays: null, source: 'none' }
}

export type ObservationExclusion = MrpObservationExclusion

export interface LineObservation {
  purchaseOrderLineId: string
  leadTimeDays: number
  /** Receipt day − expected day; null without an expected date. */
  latenessDays: number | null
  /** Received ÷ ordered over every receipt. */
  fill: number
  receiptCount: number
}

/** One clean observation per PO line (02 §6.2), or why it was left out. */
export function observeLine(
  line: ReceiptObservation
): { ok: true; value: LineObservation } | { ok: false; reason: ObservationExclusion } {
  const receipts = [...line.receipts].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
  const first = receipts[0]
  if (!first || line.quantityOrdered <= 0) return { ok: false, reason: 'not_received' }
  if (!line.orderedAt) return { ok: false, reason: 'no_ordered_at' }
  if (line.createdAt > first.day) return { ok: false, reason: 'created_after_receipt' }
  // Ordered on or after the first receipt is backfilled paperwork, not a lead time.
  if (line.orderedAt >= first.day) return { ok: false, reason: 'ordered_on_receipt_day' }

  let received = 0
  let closingDay: DayKey | null = null
  for (const r of receipts) {
    received += r.quantity
    if (!closingDay && received >= MRP_RECEIVED_SHARE_FOR_LEAD_TIME * line.quantityOrdered) {
      closingDay = r.day
    }
  }
  if (!closingDay) return { ok: false, reason: 'not_received' }

  return {
    ok: true,
    value: {
      purchaseOrderLineId: line.purchaseOrderLineId,
      leadTimeDays: daysBetween(line.orderedAt, closingDay) ?? 0,
      latenessDays: line.expectedAt ? daysBetween(line.expectedAt, closingDay) : null,
      fill: received / line.quantityOrdered,
      receiptCount: receipts.length,
    },
  }
}

export interface SupplyHistoryStats {
  /** Clean observations. */
  count: number
  excluded: number
  medianLeadTimeDays: number | null
  p90LeadTimeDays: number | null
  /** Share of observations with an expected date that arrived on or before it. */
  onTimeRate: number | null
  medianLatenessDays: number | null
  p90LatenessDays: number | null
  avgFill: number | null
}

/** Per-vendor-part (or per-part) stats over its PO lines; compared, never written (D11). */
export function summarizeSupplyHistory(lines: readonly ReceiptObservation[]): SupplyHistoryStats {
  const clean: LineObservation[] = []
  let excluded = 0
  for (const line of lines) {
    const result = observeLine(line)
    if (result.ok) clean.push(result.value)
    else if (result.reason !== 'not_received') excluded++
  }
  const leadTimes = clean.map((o) => o.leadTimeDays)
  const lateness = clean.flatMap((o) => (o.latenessDays === null ? [] : [o.latenessDays]))
  return {
    count: clean.length,
    excluded,
    medianLeadTimeDays: median(leadTimes),
    p90LeadTimeDays: percentile(leadTimes, 90),
    onTimeRate: lateness.length ? lateness.filter((d) => d <= 0).length / lateness.length : null,
    medianLatenessDays: median(lateness),
    p90LatenessDays: percentile(lateness, 90),
    avgFill: mean(clean.map((o) => o.fill)),
  }
}

/** Q10: ≥ 3 clean receipts and |median − stated| > max(3 days, 25 % of stated). */
export function hasLeadTimeDrift(
  statedLeadTimeDays: number | null,
  stats: Pick<SupplyHistoryStats, 'count' | 'medianLeadTimeDays'>
): boolean {
  if (statedLeadTimeDays === null || stats.medianLeadTimeDays === null) return false
  if (stats.count < MRP_MIN_RECEIPTS) return false
  const gap = Math.abs(stats.medianLeadTimeDays - statedLeadTimeDays)
  return gap > Math.max(MRP_DRIFT_MIN_DAYS, MRP_DRIFT_MIN_SHARE * statedLeadTimeDays)
}
