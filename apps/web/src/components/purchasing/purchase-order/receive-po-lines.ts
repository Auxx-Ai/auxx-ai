// apps/web/src/components/purchasing/purchase-order/receive-po-lines.ts

// The receive-against-a-PO dialog's payload, as a pure function of what is on
// screen (plans/purchasing/01-build-plan.md §3.1 / §4.3).
//
// Separate from the dialog for the same reason `receipt-input.ts` is separate from
// the popover: the rules below are invisible in a rendered table and each one is a
// silently-wrong number if it is missed.
//
//   1. A line receiving ZERO must not be sent. `receivePurchaseOrder` refuses any
//      line whose quantity is not greater than zero and refuses the WHOLE receipt
//      when it finds one — validation runs over the entire set before the first
//      movement, because half a shipment received is worse than a rejection. So a
//      row nobody touched has to be filtered out here, or a partly-received order
//      cannot be received at all.
//   2. The default is "everything on the order arrived", so a quantity prefills to
//      the OUTSTANDING amount, not the ordered amount. Re-receiving a fully
//      received PO must default to zero, not to a second full delivery.
//   3. Over-receipt is allowed and not clamped. A vendor shipping more than was
//      ordered is a real event the three-way match exists to surface; silently
//      capping it would hide the discrepancy at the one moment it is knowable.
//
// 🛑 There is no price here, and no header amounts. The agreed price is already
// frozen on the `purchase_order_line` and the server reads it there; the PO's
// shipping, tax and discount are ORDER-level amounts that were being spread at
// every SHIPMENT-level receipt, which capitalised the same freight once per
// delivery (§1.1 and §3.2 of
// plans/purchasing/05-receiving-cost-and-corrections.md). This door states two
// facts per line and nothing else: which line arrived, and how many.

/** One purchase-order line as the dialog knows it. */
export interface ReceivablePoLine {
  purchaseOrderLineId: string
  partId: string
  /** For the row's label when the part has not hydrated yet. */
  description: string | null
  quantityOrdered: number
  quantityReceived: number
  vendorPartId?: string
}

/** What the person keyed into one row. */
export interface ReceiptDraftLine {
  quantity: number
}

/** The `purchasing.receivePurchaseOrder` input, as this dialog builds it. */
export interface ReceivePoInput {
  lines: {
    partId: string
    purchaseOrderLineId: string
    quantity: number
    vendorPartId?: string
  }[]
  occurredAt: Date
  reference?: string
  reason?: string
}

/**
 * What is still owed on a line — rule 2 above.
 *
 * Floored at zero: an over-received line has nothing outstanding, and a negative
 * prefill would submit as a receipt the server rightly refuses.
 */
export function outstandingQuantity(line: ReceivablePoLine): number {
  return Math.max(0, line.quantityOrdered - line.quantityReceived)
}

/** Prefill the whole table with the outstanding quantity on every line. */
export function prefillDraft(lines: ReceivablePoLine[]): Record<string, ReceiptDraftLine> {
  const draft: Record<string, ReceiptDraftLine> = {}
  for (const line of lines) {
    draft[line.purchaseOrderLineId] = { quantity: outstandingQuantity(line) }
  }
  return draft
}

/** The lines actually being received — rule 1. */
export function activeLines(
  lines: ReceivablePoLine[],
  draft: Record<string, ReceiptDraftLine>
): { line: ReceivablePoLine; draft: ReceiptDraftLine }[] {
  return lines
    .map((line) => ({ line, draft: draft[line.purchaseOrderLineId] }))
    .filter(
      (row): row is { line: ReceivablePoLine; draft: ReceiptDraftLine } =>
        !!row.draft && Number.isFinite(row.draft.quantity) && row.draft.quantity > 0
    )
}

/** Build the mutation input, or `null` when nothing is being received. */
export function buildReceivePoInput(
  lines: ReceivablePoLine[],
  draft: Record<string, ReceiptDraftLine>,
  meta: { occurredAt: string; reference: string; reason: string }
): ReceivePoInput | null {
  const active = activeLines(lines, draft)
  if (active.length === 0) return null

  const reference = meta.reference.trim()
  const reason = meta.reason.trim()

  return {
    lines: active.map(({ line, draft: row }) => ({
      partId: line.partId,
      purchaseOrderLineId: line.purchaseOrderLineId,
      quantity: row.quantity,
      ...(line.vendorPartId ? { vendorPartId: line.vendorPartId } : {}),
    })),
    occurredAt: new Date(meta.occurredAt),
    ...(reference ? { reference } : {}),
    ...(reason ? { reason } : {}),
  }
}
