// packages/lib/src/mrp/run/scheduled.ts

import { addDaysToDayKey, type DayKey } from '@auxx/utils/calendar-day'
import type { SupplierInput } from '../types'
import { roundOrderQuantity } from './net-flow'
import { projectUsage } from './seasonality'
import { computeStockout, type ProjectionInput, projectOnHandAt } from './stockout'

/** One part on a scheduled supplier (02 §6.4); `projection.fromDay` is the run's asOf. */
export interface ScheduledPartInput {
  partId: string
  vendorPartId: string | null
  leadTimeDays: number | null
  /** Top of red when buffered, else 0. */
  cushion: number
  projection: ProjectionInput
  minOrderQty: number | null
  purchaseRatio: number | null
}

export interface ScheduledSupplierInput {
  asOf: DayKey
  supplier: SupplierInput
  parts: readonly ScheduledPartInput[]
}

export interface ScheduledPartPlan {
  partId: string
  vendorPartId: string | null
  cushionDate: DayKey | null
  orderByDate: DayKey | null
  /** Unticked in the UI: shown, but does not move the order date. */
  excluded: boolean
  pullsOrderForward: boolean
  /** The order-by is already past. */
  wontMakeNextArrival: boolean
  nextArrivalDate: DayKey | null
  followingArrivalDate: DayKey | null
  projectedOnHandAtNextArrival: number | null
  /** Before MOQ and pack rounding; null without a date, a lead time or a cycle. */
  rawQuantity: number | null
  quantity: number | null
  purchaseUnits: number | null
}

export interface ScheduledSupplierPlan {
  supplierId: string
  rhythmDate: DayKey | null
  /** The earlier of rhythm and the included parts' order-bys, never before asOf. */
  nextOrderDate: DayKey | null
  pulledForwardBy: string[]
  parts: ScheduledPartPlan[]
}

/** `company_next_order_date`, else the last issued/closed PO's `ordered_at` + the cycle. */
export function rhythmDate(supplier: SupplierInput): DayKey | null {
  if (supplier.nextOrderDate) return supplier.nextOrderDate
  if (supplier.lastIssuedOrderedAt && supplier.orderCycleDays && supplier.orderCycleDays > 0) {
    return addDaysToDayKey(supplier.lastIssuedOrderedAt, Math.round(supplier.orderCycleDays))
  }
  return null
}

const earlier = (a: DayKey | null, b: DayKey | null): DayKey | null =>
  a === null ? b : b === null ? a : a < b ? a : b

/** The supplier's next order date and each part's quantity, with `excludedPartIds` unticked (the live card's query). */
export function recomputeNextOrder(
  input: ScheduledSupplierInput,
  excludedPartIds: readonly string[] = []
): ScheduledSupplierPlan {
  const excluded = new Set(excludedPartIds)
  const rhythm = rhythmDate(input.supplier)
  const dated = input.parts.map((part) => ({
    part,
    ...computeStockout(part.projection, part.cushion, part.leadTimeDays),
  }))

  let next = rhythm
  for (const d of dated) if (!excluded.has(d.part.partId)) next = earlier(next, d.orderByDate)
  if (next !== null && next < input.asOf) next = input.asOf

  const cycle = input.supplier.orderCycleDays
  const pulledForwardBy: string[] = []
  const parts = dated.map(({ part, cushionDate, orderByDate }): ScheduledPartPlan => {
    const isExcluded = excluded.has(part.partId)
    const pulls = !isExcluded && rhythm !== null && orderByDate !== null && orderByDate < rhythm
    if (pulls) pulledForwardBy.push(part.partId)
    const base: ScheduledPartPlan = {
      partId: part.partId,
      vendorPartId: part.vendorPartId,
      cushionDate,
      orderByDate,
      excluded: isExcluded,
      pullsOrderForward: pulls,
      wontMakeNextArrival: orderByDate !== null && orderByDate < input.asOf,
      nextArrivalDate: null,
      followingArrivalDate: null,
      projectedOnHandAtNextArrival: null,
      rawQuantity: null,
      quantity: null,
      purchaseUnits: null,
    }
    if (next === null || part.leadTimeDays === null) return base
    const lead = Math.ceil(part.leadTimeDays)
    const nextArrival = addDaysToDayKey(next, lead)
    const projectedAtNext = projectOnHandAt(part.projection, nextArrival)
    base.nextArrivalDate = nextArrival
    base.projectedOnHandAtNextArrival = projectedAtNext
    if (!cycle || cycle <= 0) return base

    const following = addDaysToDayKey(next, Math.round(cycle) + lead)
    const usage = projectUsage(
      part.projection.baseAdu,
      part.projection.seasonalIndex,
      nextArrival,
      following
    )
    const landingBetween = part.projection.receipts
      .filter((r) => r.day > nextArrival && r.day < following)
      .reduce((sum, r) => sum + r.quantity, 0)
    const raw = usage + part.cushion - projectedAtNext - landingBetween
    const rounded = roundOrderQuantity(raw, part.minOrderQty, part.purchaseRatio)
    return {
      ...base,
      followingArrivalDate: following,
      rawQuantity: raw,
      quantity: rounded.quantity,
      purchaseUnits: rounded.purchaseUnits,
    }
  })

  return {
    supplierId: input.supplier.id,
    rhythmDate: rhythm,
    nextOrderDate: next,
    pulledForwardBy,
    parts,
  }
}

export interface BridgeQuantity {
  bridgeArrivalDate: DayKey
  rawQuantity: number
  quantity: number
  purchaseUnits: number
}

/** What an unticked part needs from another vendor part to reach the container (02 §6.4). */
export function bridgeQuantity(params: {
  asOf: DayKey
  bridgeLeadTimeDays: number
  /** The order date for the current ticks + the container's lead time. */
  containerArrivalDate: DayKey
  cushion: number
  projection: ProjectionInput
  minOrderQty: number | null
  purchaseRatio: number | null
}): BridgeQuantity {
  const bridgeArrival = addDaysToDayKey(params.asOf, Math.ceil(params.bridgeLeadTimeDays))
  const usage =
    params.containerArrivalDate > bridgeArrival
      ? projectUsage(
          params.projection.baseAdu,
          params.projection.seasonalIndex,
          bridgeArrival,
          params.containerArrivalDate
        )
      : 0
  const raw = usage + params.cushion - projectOnHandAt(params.projection, bridgeArrival)
  return {
    bridgeArrivalDate: bridgeArrival,
    rawQuantity: raw,
    ...roundOrderQuantity(raw, params.minOrderQty, params.purchaseRatio),
  }
}
