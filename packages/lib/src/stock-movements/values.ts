// packages/lib/src/stock-movements/values.ts

/**
 * The values bag every `stock_movement` writer hands to `UnifiedCrudHandler`.
 *
 * 🛑 **The nine keys, in one place.** 50 §2.1: "`stock_movement_adjust_subparts:
 * false` is written in six separate files, each with its own hand-written
 * paragraph explaining why." This is that paragraph, once, and the function
 * every one of the six callers now goes through to get there - the atomic
 * writers via `write-movements.ts`, `bulk-opening-stock.ts` directly (its
 * `bulkCreate` cardinality is not part of this module's contract - see §2.2,
 * which does not name cardinality as a shared axis).
 */

import { computeExtendedCost } from '../receiving/client'
import type { RecordId } from '../resources/resource-id'

/** Already-resolved link targets, keyed the way the movement stores them. */
export interface ResolvedStockMovementLinks {
  vendorPart?: RecordId
  purchaseOrderLine?: RecordId
  build?: RecordId
  reversesMovement?: RecordId
  parentMovement?: RecordId
  fulfillmentLine?: RecordId
}

/** Everything `buildStockMovementValues` needs, with every link already a `RecordId`. */
export interface StockMovementValueFields {
  partRecordId: RecordId
  type: string
  quantity: number
  unitCost: number
  /** Omit to omit `stock_movement_cost_basis` entirely - see `types.ts`'s header. */
  costBasis?: string
  /** Omit to omit `stock_movement_gl_account` entirely - see `types.ts`'s header. */
  glAccount?: string
  occurredAt: Date
  /** Override for `computeExtendedCost(unitCost, quantity)`. See `StockMovementInput.extendedCost`. */
  extendedCost?: number
  adjustSubparts?: true
  reason?: string
  reference?: string
  qtyPerUnit?: number | null
  vendorUnitPrice?: number
  links?: ResolvedStockMovementLinks
}

/**
 * Build the values bag for one `stock_movement` create.
 *
 * 🛑 **`stock_movement_adjust_subparts` is ALWAYS present and is `true` only
 * when the caller explicitly opted in.** `explodeBomMovement` inherits the
 * parent movement's type AND its sign, so a `true` on the wrong writer
 * cascades a receipt, an adjustment, a build leg or a reversal through the
 * bill of materials - six separate defects this default exists to close at
 * once (50 §2.1, §2.4 item 1).
 *
 * **The sign convention has one owner.** `extendedCost` is
 * `computeExtendedCost(unitCost, quantity)` unless the caller supplies its
 * own - the one documented override `complete-build.ts`'s negated
 * `build_consume` row needs, because deriving it from
 * `round(unitCost x -consumed)` instead can differ from
 * `-round(unitCost x consumed)` on a half-cent tail (`Math.round` breaks ties
 * toward positive infinity). §2.2, §2.4 item 2.
 */
export function buildStockMovementValues(
  fields: StockMovementValueFields
): Record<string, unknown> {
  const {
    partRecordId,
    type,
    quantity,
    unitCost,
    costBasis,
    glAccount,
    occurredAt,
    extendedCost,
    adjustSubparts,
    reason,
    reference,
    qtyPerUnit,
    vendorUnitPrice,
    links,
  } = fields

  const values: Record<string, unknown> = {
    stock_movement_part: partRecordId,
    stock_movement_type: type,
    stock_movement_quantity: quantity,
    stock_movement_adjust_subparts: adjustSubparts === true,
    stock_movement_unit_cost: unitCost,
    stock_movement_extended_cost: extendedCost ?? computeExtendedCost(unitCost, quantity),
    stock_movement_occurred_at: occurredAt.toISOString(),
  }

  if (costBasis !== undefined) values.stock_movement_cost_basis = costBasis
  if (glAccount !== undefined) values.stock_movement_gl_account = glAccount
  if (reason) values.stock_movement_reason = reason
  if (reference) values.stock_movement_reference = reference
  if (vendorUnitPrice != null) values.stock_movement_vendor_unit_price = vendorUnitPrice
  // NULL is the off-BOM marker and is written as an absence, not a zero.
  if (qtyPerUnit != null) values.stock_movement_qty_per_unit = qtyPerUnit

  if (links?.vendorPart) values.stock_movement_vendor_part = links.vendorPart
  if (links?.purchaseOrderLine) values.stock_movement_purchase_order_line = links.purchaseOrderLine
  if (links?.build) values.stock_movement_build = links.build
  if (links?.reversesMovement) values.stock_movement_reverses_movement = links.reversesMovement
  if (links?.parentMovement) values.stock_movement_parent_movement = links.parentMovement
  if (links?.fulfillmentLine) values.stock_movement_fulfillment_line = links.fulfillmentLine

  return values
}
