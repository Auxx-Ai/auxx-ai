// packages/lib/src/purchasing/purchase-order-status.ts

import {
  PurchaseOrderBillingStatus,
  PurchaseOrderReceiptStatus,
} from '../resources/registry/enum-values'

/**
 * The order-level verdicts derived from the purchase order LINE roll-ups
 * (plans/purchasing/07-purchase-order-send-and-status.md §3.3).
 *
 * This file is pure on purpose: it takes numbers and returns two strings. The
 * database half lives in `purchase-order-status-writer.ts`, which is the only
 * thing that knows what a `FieldValue` is. Keeping the rule here means the nine
 * receipt/billing combinations, over-receipt and the empty order are all
 * testable without a single mock — the same split `match.ts` / `match-hook.ts`
 * already uses.
 *
 * 🛑 The two axes are INDEPENDENT and neither one is a summary of the other.
 * This business prepays: *fully billed, nothing received* is a normal state
 * lasting weeks (§3.3). Do not fold them back into one verdict.
 */

/** `purchase_order_receipt_status` — the GOODS axis. */
export type PurchaseOrderReceiptStatusValue = (typeof PurchaseOrderReceiptStatus)[
  | 'NOT_RECEIVED'
  | 'PARTIALLY_RECEIVED'
  | 'RECEIVED']

/** `purchase_order_billing_status` — the MONEY axis. BILLED, never PAID (§3.6). */
export type PurchaseOrderBillingStatusValue = (typeof PurchaseOrderBillingStatus)[
  | 'NOT_BILLED'
  | 'PARTIALLY_BILLED'
  | 'BILLED']

/**
 * One purchase order line reduced to the three numbers the verdict needs.
 *
 * `quantityReceived` and `quantityBilled` are the roll-ups
 * `purchase-order-line-rollups.ts` re-SUMs; `quantityOrdered` is what a human
 * typed. A missing value reads as `0` — the caller resolves that, so this
 * module never sees a `null`.
 */
export interface PurchaseOrderLineQuantities {
  quantityOrdered: number
  quantityReceived: number
  quantityBilled: number
}

/** Both derived verdicts for one purchase order. */
export interface PurchaseOrderDerivedStatuses {
  receiptStatus: PurchaseOrderReceiptStatusValue
  billingStatus: PurchaseOrderBillingStatusValue
}

/** The three rungs of one axis, so the classifier can be written once. */
interface AxisRegister<T extends string> {
  none: T
  partial: T
  complete: T
}

const RECEIPT_AXIS: AxisRegister<PurchaseOrderReceiptStatusValue> = {
  none: PurchaseOrderReceiptStatus.NOT_RECEIVED,
  partial: PurchaseOrderReceiptStatus.PARTIALLY_RECEIVED,
  complete: PurchaseOrderReceiptStatus.RECEIVED,
}

const BILLING_AXIS: AxisRegister<PurchaseOrderBillingStatusValue> = {
  none: PurchaseOrderBillingStatus.NOT_BILLED,
  partial: PurchaseOrderBillingStatus.PARTIALLY_BILLED,
  complete: PurchaseOrderBillingStatus.BILLED,
}

/**
 * Classify one axis of a purchase order.
 *
 * 🛑 The completion test is `>=`, never `===`. Over-receipt is legal and
 * ordinary — a vendor ships 105 of an order for 100 — and an equality test
 * would report that order as `partially_received` forever, which is the exact
 * inverse of the truth. The same holds for an over-billed line.
 *
 * ⚠️ Order of the two tests matters. `complete` is checked first so a line that
 * is fully satisfied cannot be dragged down by the `> 0` partial test, and
 * `partial` needs strictly positive progress so a credit or a reversal that
 * leaves the line at `0` reads as `none` rather than `partial`.
 *
 * A line with `quantityOrdered === 0` satisfies `progress >= ordered` at zero
 * progress. That is deliberate: nothing was ordered, so nothing is outstanding,
 * and such a line must not hold an otherwise-complete order open.
 */
function classifyAxis<T extends string>(
  lines: readonly PurchaseOrderLineQuantities[],
  progressOf: (line: PurchaseOrderLineQuantities) => number,
  register: AxisRegister<T>
): T {
  // An empty order is `none`, NOT `complete`. `every` over an empty list is
  // vacuously true, so without this guard a purchase order somebody has only
  // just created — no lines typed yet — would be labelled fully received and
  // fully billed. See {@link derivePurchaseOrderStatuses}.
  if (lines.length === 0) return register.none

  if (lines.every((line) => progressOf(line) >= line.quantityOrdered)) return register.complete
  if (lines.some((line) => progressOf(line) > 0)) return register.partial
  return register.none
}

/**
 * Derive `purchase_order_receipt_status` and `purchase_order_billing_status`
 * from the order's lines.
 *
 * ```
 * receipt_status:  every line received >= ordered  -> received
 *                  any   line received >  0        -> partially_received
 *                  otherwise                       -> not_received
 *
 * billing_status:  every line billed   >= ordered  -> billed
 *                  any   line billed   >  0        -> partially_billed
 *                  otherwise                       -> not_billed
 * ```
 *
 * ✅ **Zero lines returns `not_received` / `not_billed`.** The alternative —
 * letting the vacuous `every` win — would stamp every freshly created purchase
 * order as complete on both axes before anybody had typed a line, and it would
 * then flip *backwards* to `not_received` the moment the first line landed. A
 * status that reads "done" for an order nobody has placed is worse than one
 * that reads "not started".
 *
 * Pure and total: it queries nothing, throws nothing, and given the same lines
 * always returns the same pair.
 */
export function derivePurchaseOrderStatuses(
  lines: readonly PurchaseOrderLineQuantities[]
): PurchaseOrderDerivedStatuses {
  return {
    receiptStatus: classifyAxis(lines, (line) => line.quantityReceived, RECEIPT_AXIS),
    billingStatus: classifyAxis(lines, (line) => line.quantityBilled, BILLING_AXIS),
  }
}
