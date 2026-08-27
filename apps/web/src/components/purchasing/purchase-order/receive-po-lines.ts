// apps/web/src/components/purchasing/purchase-order/receive-po-lines.ts

// The receive-against-a-PO dialog's arithmetic, as a pure function of what is on
// screen (plans/purchasing/01-build-plan.md §3.1 / §4.3).
//
// Separate from the dialog for the same reason `receipt-input.ts` is separate from
// the popover: the rules below are invisible in a rendered table and each one is a
// silently-wrong number if it is missed.
//
//   1. A line receiving ZERO must not take part in the allocation. Freight is
//      spread across what was on the truck; including a line that did not arrive
//      dilutes every other line's share and understates the cost of the goods that
//      did. It is also not merely display — `receivePurchaseOrder` allocates over
//      exactly the lines it is sent.
//   2. The default is "everything on the order arrived", so a quantity prefills to
//      the OUTSTANDING amount, not the ordered amount. Re-receiving a fully
//      received PO must default to zero, not to a second full delivery.
//   3. Over-receipt is allowed and not clamped. A vendor shipping more than was
//      ordered is a real event the three-way match exists to surface; silently
//      capping it would hide the discrepancy at the one moment it is knowable.

import { allocateLandedCost } from '@auxx/lib/purchasing/client'
import { roundMinorUnits } from '@auxx/lib/receiving/client'

/** One purchase-order line as the dialog knows it. */
export interface ReceivablePoLine {
  purchaseOrderLineId: string
  partId: string
  /** For the row's label when the part has not hydrated yet. */
  description: string | null
  quantityOrdered: number
  quantityReceived: number
  /** The agreed buy price, minor units — the prefill for the price input. */
  expectedUnitPrice: number
  vendorPartId?: string
  /** Shipping weight for the whole line. Read only by the `weight` basis. */
  weight?: number
}

/** What the person keyed into one row. */
export interface ReceiptDraftLine {
  quantity: number
  unitPrice: number
}

/** The PO header's stated amounts — the freight-allocation inputs. */
export interface ReceiptHeader {
  shipping: number
  tax: number
  discount: number
  taxRecoverable: boolean
  basis: 'value' | 'quantity' | 'weight'
}

/** The `purchasing.receivePurchaseOrder` input, as this dialog builds it. */
export interface ReceivePoInput {
  lines: {
    partId: string
    purchaseOrderLineId: string
    quantity: number
    unitPrice: number
    vendorPartId?: string
    weight?: number
  }[]
  shipping?: number
  tax?: number
  discount?: number
  taxRecoverable?: boolean
  basis?: 'value' | 'quantity' | 'weight'
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

/** Prefill the whole table: outstanding quantity at the agreed price. */
export function prefillDraft(lines: ReceivablePoLine[]): Record<string, ReceiptDraftLine> {
  const draft: Record<string, ReceiptDraftLine> = {}
  for (const line of lines) {
    draft[line.purchaseOrderLineId] = {
      quantity: outstandingQuantity(line),
      unitPrice: line.expectedUnitPrice,
    }
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

/**
 * Allocated landed unit cost per active line, keyed by PO line id.
 *
 * The same `allocateLandedCost` the server runs, over the same set of lines, so
 * the column the person reads before committing is the number that gets frozen.
 */
export function allocatedUnitCosts(
  lines: ReceivablePoLine[],
  draft: Record<string, ReceiptDraftLine>,
  header: ReceiptHeader
): Record<string, number> {
  const active = activeLines(lines, draft)
  if (active.length === 0) return {}

  const unitCosts = allocateLandedCost(
    active.map(({ line, draft: row }) => ({
      lineTotal: roundMinorUnits(row.unitPrice * row.quantity),
      quantity: row.quantity,
      weight: line.weight,
    })),
    {
      shipping: header.shipping,
      tax: header.tax,
      discount: header.discount,
      taxRecoverable: header.taxRecoverable,
    },
    header.basis
  )

  const byLine: Record<string, number> = {}
  active.forEach(({ line }, index) => {
    const cost = unitCosts[index]
    if (cost != null) byLine[line.purchaseOrderLineId] = cost
  })
  return byLine
}

/** Goods value before the header amounts are spread onto it. */
export function receiptSubtotal(
  lines: ReceivablePoLine[],
  draft: Record<string, ReceiptDraftLine>
): number {
  return activeLines(lines, draft).reduce(
    (sum, { draft: row }) => sum + roundMinorUnits(row.unitPrice * row.quantity),
    0
  )
}

/**
 * Build the mutation input, or `null` when nothing is being received.
 *
 * Header amounts are sent whole. They are the PO's stated totals and the server
 * spreads them over exactly the lines it is given — so receiving half an order
 * capitalises the full freight onto that half, which is correct: the truck came
 * once. Receiving the rest later with the freight already consumed is a real
 * question this does not answer; see the note in the dialog.
 */
export function buildReceivePoInput(
  lines: ReceivablePoLine[],
  draft: Record<string, ReceiptDraftLine>,
  header: ReceiptHeader,
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
      unitPrice: roundMinorUnits(row.unitPrice),
      ...(line.vendorPartId ? { vendorPartId: line.vendorPartId } : {}),
      ...(line.weight != null ? { weight: line.weight } : {}),
    })),
    shipping: header.shipping,
    tax: header.tax,
    discount: header.discount,
    taxRecoverable: header.taxRecoverable,
    basis: header.basis,
    occurredAt: new Date(meta.occurredAt),
    ...(reference ? { reference } : {}),
    ...(reason ? { reason } : {}),
  }
}
