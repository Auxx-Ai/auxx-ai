// packages/lib/src/mrp/run/net-flow.ts

import { type DayKey, daysBetween } from '@auxx/utils/calendar-day'
import { ceilToMultiple } from '@auxx/utils/rounding'
import type { MrpSuggestionKind, MrpSupplyType } from '../client'
import type { OpenBuildInput, OpenPoLineInput } from '../types'

export interface Position {
  onHand: number
  /** Issued PO lines (D17) plus open builds. */
  onOrder: number
  openDemand: number
  netFlow: number
}

/** Net flow = on hand + on order − open demand; draft lines never count (D17). */
export function computePosition(params: {
  onHand: number
  poLines: readonly OpenPoLineInput[]
  builds: readonly OpenBuildInput[]
  openDemand: number
}): Position {
  let onOrder = 0
  for (const line of params.poLines) {
    if (line.status === 'issued' && line.quantityOpen > 0) onOrder += line.quantityOpen
  }
  for (const build of params.builds) if (build.quantityOpen > 0) onOrder += build.quantityOpen
  const openDemand = Math.max(0, params.openDemand)
  return {
    onHand: params.onHand,
    onOrder,
    openDemand,
    netFlow: params.onHand + onOrder - openDemand,
  }
}

/** Lower is more urgent (D13): net flow ÷ top of green when buffered, days until order-by otherwise. */
export function computePriority(params: {
  buffered: boolean
  netFlow: number
  topOfGreen: number | null
  orderByDate: DayKey | null
  asOf: DayKey
}): number | null {
  if (params.buffered && params.topOfGreen) return params.netFlow / params.topOfGreen
  if (params.orderByDate) return daysBetween(params.asOf, params.orderByDate)
  return null
}

export interface RoundedQuantity {
  /** Per each, ≥ MOQ and whole purchase units (D14). */
  quantity: number
  /** `quantity ÷ purchaseRatio`; equals `quantity` without a ratio. */
  purchaseUnits: number
}

/** Raise to MOQ, then up to whole purchase units; a need of 0 or less stays 0. */
export function roundOrderQuantity(
  rawQuantity: number,
  minOrderQty: number | null,
  purchaseRatio: number | null
): RoundedQuantity {
  if (!(rawQuantity > 0)) return { quantity: 0, purchaseUnits: 0 }
  const quantity = ceilToMultiple(Math.max(rawQuantity, minOrderQty ?? 0), purchaseRatio ?? 0)
  const ratio = purchaseRatio && purchaseRatio > 0 ? purchaseRatio : 1
  return { quantity, purchaseUnits: Number((quantity / ratio).toPrecision(12)) }
}

export interface WhenNeededSuggestion {
  kind: MrpSuggestionKind
  rawQuantity: number
  quantity: number
  purchaseUnits: number
}

/** Primer §4.4: net flow at or below top of yellow orders up to top of green; buffered parts only. */
export function suggestWhenNeeded(params: {
  buffered: boolean
  supplyType: MrpSupplyType
  netFlow: number
  topOfYellow: number | null
  topOfGreen: number | null
  minOrderQty: number | null
  purchaseRatio: number | null
}): WhenNeededSuggestion | null {
  if (!params.buffered || params.topOfYellow === null || params.topOfGreen === null) return null
  if (params.supplyType === 'unclassified' || params.netFlow > params.topOfYellow) return null
  const rawQuantity = params.topOfGreen - params.netFlow
  if (params.supplyType === 'made') {
    return { kind: 'build', rawQuantity, quantity: rawQuantity, purchaseUnits: rawQuantity }
  }
  const rounded = roundOrderQuantity(rawQuantity, params.minOrderQty, params.purchaseRatio)
  return { kind: 'purchase', rawQuantity, ...rounded }
}
