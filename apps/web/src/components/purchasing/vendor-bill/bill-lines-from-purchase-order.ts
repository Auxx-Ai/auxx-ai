// apps/web/src/components/purchasing/vendor-bill/bill-lines-from-purchase-order.ts

// Which purchase order lines a bill can still be filled from, and what a bill line
// created from one carries (plans/purchasing/02-handoff.md §4 item 3c).
//
// Pure on purpose: which lines are offered, and which fields are prefilled, are
// the two decisions worth pinning with a test rather than eyeballing in a drawer.
//
// ─────────────────────────────────────────────────────────────────────────────
// 🛑 THE RULE THIS FILE OBEYS
//
// `create-bill-from-purchase-order-dialog.tsx` settled it for the header total,
// and the reasoning transfers verbatim:
//
//   *"It is safe here because the header total is NOT a match input: `matchBill`
//   weighs `quantityBilled` and `unitPriceBilled` off the LINES."*
//
// So: prefill anything that is not a match input; never prefill one that is.
//
//   prefilled  purchaseOrderLine  the match KEY — the join, not a compared value,
//                                 and by far the fiddliest thing to set by hand
//   prefilled  part               the registry already says "STAMPED from the PO
//                                 line at write, not hand-set"
//   prefilled  description        not a match input
//   prefilled  glAccount          `2160` GRNI for a PO-matched line (01 §5.2)
//   BLANK      quantityBilled     compared against `quantityReceived`
//   BLANK      unitPrice          compared against `expectedUnitPrice`
//   BLANK      lineTotal          derived from the two above
//
// ⚠️ `quantityBilled` cannot actually be left empty — it is `nullable: false`
// with `defaultValue: 1`, so a created line reads **1** until someone types the
// real number. That is deliberate, and it is loud in the case that matters:
// `DEFAULT_MATCH_TOLERANCE` carries `quantityExact: true`, so a line billed 1
// against 10 RECEIVED raises `quantity_under_billed` rather than passing quietly.
// Prefilling it from the receipt would be the opposite trade — fast, and silently
// asserting that the vendor billed exactly what arrived, which is the question
// the quantity arm exists to ask.
//
// ⚠️ It is NOT loud when nothing has been received yet. Under P24 a line billed 1
// against 0 received is `awaiting_receipt`, not an exception — the prepaid case —
// so a forgotten quantity on a bill entered ahead of the goods sits amber rather
// than red until the goods land, and only then becomes `quantity_under_billed`.
// That is the price of not flooding the queue with prepayments; the forgotten
// quantity does still surface, just later.
// ─────────────────────────────────────────────────────────────────────────────

import type { RecordId } from '@auxx/types/resource'
import type { PurchaseOrderLineRow } from '../purchase-order/use-purchase-order-lines'

/** GRNI. A PO-matched bill line relieves the accrual the receipt raised (01 §5.2). */
export const GRNI_ACCOUNT_CODE = '2160'

/**
 * The purchase order lines this bill can still be filled from.
 *
 * Two independent filters, and both are needed:
 *
 * 1. **Still uninvoiced** — `billed < ordered`. What is left to bill on the ORDER,
 *    which is a fact about the order and not about the warehouse.
 * 2. **Not already on THIS bill.** 🛑 Without it the action duplicates every line
 *    on a second press, and it would do so *reliably*: a line created here starts
 *    at the default quantity with no price, so `quantity_billed` barely moves and
 *    filter (1) keeps offering the same line back. Membership of this bill is
 *    exact regardless of what has been typed into it, which is why it is the
 *    guard that makes the action safe to press twice.
 *
 * A line still legitimately split across two bills stays offerable on the second
 * one, because filter (2) is scoped to the bill being filled.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🛑 THIS GATE USED TO BE `received > billed`, AND THAT WAS WRONG
 *
 * The old rule read as the per-line GRNI residual — "something arrived that
 * nobody has billed yet" — which is impeccable double-entry and the wrong
 * question to ask a person entering an invoice.
 *
 * **Vendors invoice ahead of delivery as a matter of course, and some will not
 * ship at all until the invoice is paid.** Full prepayment before dispatch is
 * the norm on Chinese supply, where the goods then sit on a boat for thirty to
 * forty-five days. Deposits, freight-forwarder invoices and drop-ships land the
 * same way. Under `received > billed` every one of those bills offered ZERO
 * lines, so the one document that unblocks the shipment was the one document
 * this dialog would not help you enter.
 *
 * It also failed silently: both callers render nothing at all when the count is
 * zero, so the surface was indistinguishable from "not built".
 *
 * ⚠️ The receipt has NOT stopped mattering — it moved to where it belongs. Billed
 * against received is the three-way match's quantity arm (`purchasing/match.ts`),
 * which compares the two on every line and is the thing that catches paying for
 * goods that never arrive. Answering that question twice, once as a silent filter
 * on what you may type and once as a check on what you typed, only ever hid the
 * check.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function selectBillableLines(
  purchaseOrderLines: PurchaseOrderLineRow[],
  /** `purchaseOrderLine` of every line already on this bill. */
  alreadyOnThisBill: readonly (RecordId | null | undefined)[]
): PurchaseOrderLineRow[] {
  const taken = new Set(alreadyOnThisBill.filter((id): id is RecordId => !!id))
  return purchaseOrderLines.filter(
    (line) => line.billed < line.ordered && !taken.has(line.lineRecordId)
  )
}

/**
 * The `record.create` payload for one bill line raised from a purchase order line.
 *
 * Absent keys are absent, not null: `quantityBilled` falls to its registry default
 * and `unitPrice` / `lineTotal` stay empty for the person holding the invoice to
 * fill in. See this file's header for why those three are the ones left alone.
 */
export function billLineValuesFromPurchaseOrderLine(
  line: PurchaseOrderLineRow,
  billRecordId: RecordId,
  sortOrder: number
): Record<string, unknown> {
  const values: Record<string, unknown> = {
    vendor_bill_line_vendor_bill: billRecordId,
    vendor_bill_line_purchase_order_line: line.lineRecordId,
    vendor_bill_line_gl_account: GRNI_ACCOUNT_CODE,
    vendor_bill_line_sort_order: sortOrder,
  }
  if (line.partRecordId) values.vendor_bill_line_part = line.partRecordId
  if (line.description) values.vendor_bill_line_description = line.description
  return values
}

/** The whole batch, in the order's own line order. */
export function billLinesFromPurchaseOrder(
  billableLines: PurchaseOrderLineRow[],
  billRecordId: RecordId,
  /** Highest `sortOrder` already on the bill, so appended lines land after it. */
  startSortOrder: number
): Record<string, unknown>[] {
  return billableLines.map((line, index) =>
    billLineValuesFromPurchaseOrderLine(line, billRecordId, startSortOrder + index + 1)
  )
}
