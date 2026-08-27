// apps/web/src/components/manufacturing/parts/receipt-input.ts

// What the Receive form actually sends, as a pure function of what is on screen.
//
// Extracted from `receive-stock-popover.tsx` because the one rule here is
// invisible in a rendered form: THE FORM SENDS A PRICE, NEVER A COST. The price
// it sends is the base — what the packing slip says the vendor charged — and the
// server applies the supplier row's freight, tariff and other terms on top of it
// and owns the landed figure that gets frozen onto the movement. There is no
// `unitCost` on the wire, and `purchasing.receiveStock`'s input schema does not
// accept one, which is what makes "the browser cannot assert an inventory cost"
// a fact rather than a convention
// (plans/purchasing/05-receiving-cost-and-corrections.md §4.1).
//
// The breakdown this module computes is DISPLAY ONLY — the same arithmetic the
// server runs, shown so the person keying the receipt can see what it will cost
// before committing. It is a preview of a server-computed number, not the number
// being submitted.

import type { ReceiptCostInputs, ReceiptCostParts } from '@auxx/lib/receiving/client'
import { computeReceiptLandedBreakdown } from '@auxx/lib/receiving/client'

/** The `purchasing.receiveStock` input, as this form builds it. */
export interface ReceiptInput {
  partId: string
  quantity: number
  vendorPartId?: string
  /** The BASE price per unit, minor units — never the landed cost. */
  vendorUnitPrice: number
  occurredAt: Date
  reference?: string
  reason?: string
}

/** Everything on the form that decides the payload. */
export interface ReceiptFormState {
  partId: string
  quantity: number | null
  /** The selected supplier row, or null when the part has none. */
  vendorPartId: string | null
  /** The selected row's freight/tariff/other terms. */
  terms: Pick<ReceiptCostInputs, 'shippingCost' | 'tariffRate' | 'otherCost'> | null
  /** The base price as it stands in the input — prefilled, possibly edited. */
  unitPrice: number | null
  /** ISO string from the date input. */
  occurredAt: string
  reference: string
  reason: string
}

/**
 * The landed breakdown for the price currently on screen — for display.
 *
 * The adders come from the selected supplier row and the base comes from the
 * INPUT, not the row: freight and tariff terms still apply to a price the vendor
 * actually charged, so an edited price is a new base under the same terms rather
 * than a reason to drop them. That is the same rule `resolveReceiptPrice` applies
 * server-side, which is why the figure shown here is the figure stored.
 */
export function receiptBreakdown(state: ReceiptFormState): ReceiptCostParts | null {
  if (state.unitPrice == null) return null
  return computeReceiptLandedBreakdown({
    unitPrice: state.unitPrice,
    shippingCost: state.terms?.shippingCost ?? null,
    tariffRate: state.terms?.tariffRate ?? null,
    otherCost: state.terms?.otherCost ?? null,
  })
}

/**
 * Build the mutation input, or `null` when the form is not submittable.
 *
 * Not submittable means: no positive quantity, no price at all, or a price that
 * lands at or below zero. The last one is refused here as well as on the server
 * (`receiveStock` throws `UnprocessableEntityError`) because a disabled button is
 * a better answer than a toast — but the server check is the real guard, and this
 * one must never be the only one.
 */
export function buildReceiptInput(state: ReceiptFormState): ReceiptInput | null {
  if (state.quantity == null || !Number.isFinite(state.quantity) || state.quantity <= 0) return null

  const breakdown = receiptBreakdown(state)
  if (!breakdown || breakdown.landed <= 0) return null

  const reference = state.reference.trim()
  const reason = state.reason.trim()

  return {
    partId: state.partId,
    quantity: state.quantity,
    ...(state.vendorPartId ? { vendorPartId: state.vendorPartId } : {}),
    // The base only. The server reads the supplier row for the adders and
    // resolves the landed cost itself — see the note at the top of this file.
    vendorUnitPrice: breakdown.base,
    occurredAt: new Date(state.occurredAt),
    ...(reference ? { reference } : {}),
    ...(reason ? { reason } : {}),
  }
}
