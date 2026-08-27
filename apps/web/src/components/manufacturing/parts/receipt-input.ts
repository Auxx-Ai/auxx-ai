// apps/web/src/components/manufacturing/parts/receipt-input.ts

// What the Receive form actually sends, as a pure function of what is on screen.
//
// Extracted from `receive-stock-popover.tsx` because ONE detail here is both
// load-bearing and invisible: `receiveStock` derives the landed cost from the
// supplier row's OWN `unitPrice` whenever `unitCost` is absent
// (`receive-stock.ts` → `resolveReceiptPrice`). So a form that sends only the
// edited `vendorUnitPrice` stores a cost computed from the price the user just
// replaced — the edit appears to work, the row looks right, and the frozen cost
// is wrong forever. Nothing throws.
//
// The rule is therefore: whenever the form can price a receipt at all, it sends
// BOTH figures, and the landed one is the same number the breakdown showed.

import type { ReceiptCostInputs, ReceiptCostParts } from '@auxx/lib/receiving/client'
import { computeReceiptLandedBreakdown } from '@auxx/lib/receiving/client'

/** The `purchasing.receiveStock` input, as this form builds it. */
export interface ReceiptInput {
  partId: string
  quantity: number
  vendorPartId?: string
  vendorUnitPrice: number
  unitCost: number
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
 * The landed breakdown for the price currently on screen.
 *
 * The adders come from the selected supplier row and the base comes from the
 * INPUT, not the row: freight and tariff terms still apply to a price the vendor
 * actually charged, so an edited price is a new base under the same terms rather
 * than a reason to drop them.
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
    // Both, always — see the note at the top of this file.
    vendorUnitPrice: breakdown.base,
    unitCost: breakdown.landed,
    occurredAt: new Date(state.occurredAt),
    ...(reference ? { reference } : {}),
    ...(reason ? { reason } : {}),
  }
}
