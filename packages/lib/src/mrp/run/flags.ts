// packages/lib/src/mrp/run/flags.ts

import type { DayKey } from '@auxx/utils/calendar-day'
import {
  MRP_FLAGS,
  MRP_UNBUILT_SALES_TOLERANCE,
  type MrpBufferMode,
  type MrpFlag,
  type MrpLeadTimeSource,
  type MrpSupplyType,
} from '../client'
import type { OpenPoLineInput, SubpartRow } from '../types'

/** 01 §3 P3 for a made finished good: sold − (produced + opening) above 10 % of sold. */
export function isUnbuiltSeller(params: {
  sold: number
  produced: number
  opening: number
}): boolean {
  if (params.sold <= 0) return false
  const gap = params.sold - params.produced - Math.max(0, params.opening)
  return gap > MRP_UNBUILT_SALES_TOLERANCE * params.sold
}

/** The flagged finished goods and every part below them: their ledger consumption is understated too. */
export function unbuiltSalesPartIds(
  flaggedPartIds: Iterable<string>,
  edges: readonly SubpartRow[]
): Set<string> {
  const children = new Map<string, string[]>()
  for (const e of edges) {
    children.set(e.parentPartId, [...(children.get(e.parentPartId) ?? []), e.childPartId])
  }
  const result = new Set<string>()
  const stack = [...flaggedPartIds]
  while (stack.length > 0) {
    const id = stack.pop() as string
    if (result.has(id)) continue
    result.add(id)
    stack.push(...(children.get(id) ?? []))
  }
  return result
}

/** The mirror's closing `onHandEod` disagrees with `part_quantity_on_hand` (08 §3.1). */
export function hasMirrorDrift(
  closingOnHandEod: number | null,
  quantityOnHand: number,
  tolerance = 1e-6
): boolean {
  return closingOnHandEod !== null && Math.abs(closingOnHandEod - quantityOnHand) > tolerance
}

export interface FlagInput {
  asOf: DayKey
  supplyType: MrpSupplyType
  leadTimeSource: MrpLeadTimeSource
  bufferMode: MrpBufferMode | null
  /** P1: this part's fulfillment lines relief skipped, so no `sale` was written. */
  reliefGapLines: number
  /** From {@link unbuiltSalesPartIds}. */
  unbuiltSales: boolean
  leadTimeDrift: boolean
  /** Mirror drift from the nightly check or {@link hasMirrorDrift}. */
  mirrorDrift: boolean
  wontMakeNextArrival: boolean
  /** The part's open PO lines, issued and draft. */
  poLines: readonly OpenPoLineInput[]
}

/** Every data-quality flag for one part, in `MRP_FLAGS` order (02 §7 step 10, 04 §6). */
export function computeFlags(input: FlagInput): MrpFlag[] {
  const raised = new Set<MrpFlag>()
  if (input.reliefGapLines > 0) raised.add('relief_gaps')
  if (input.unbuiltSales) raised.add('unbuilt_sales')
  // `unclassified` already names what is missing; there is no vendor part or build to time.
  if (input.leadTimeSource === 'none' && input.supplyType !== 'unclassified') {
    raised.add('no_lead_time')
  }
  if (input.leadTimeDrift) raised.add('lead_time_drift')
  const open = input.poLines.filter((l) => l.quantityOpen > 0)
  if (
    open.some((l) => l.status === 'issued' && l.expectedAt !== null && l.expectedAt < input.asOf)
  ) {
    raised.add('overdue_receipt')
  }
  if (input.mirrorDrift) raised.add('mirror_drift')
  if (input.wontMakeNextArrival) raised.add('wont_make_next_arrival')
  if (open.some((l) => l.status === 'draft')) raised.add('draft_po_pending')
  if (input.supplyType === 'unclassified') raised.add('unclassified')
  if (input.supplyType === 'bought' && input.bufferMode === 'not_buffered') {
    raised.add('not_buffered_bought')
  }
  return MRP_FLAGS.filter((f) => raised.has(f))
}
