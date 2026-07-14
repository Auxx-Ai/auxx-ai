// packages/lib/src/money/payments/partial.ts
// Partial-payment amount bounds for money MP2 §C (partial/custom amounts on `/pay`) and §H's
// test-plan extraction. Pure function — no Stripe import, no DB access — same shape as
// `resolveApplicationFee` (fees.ts) and `computeDepositAmount` (deposit.ts), unit-tested the
// same way (partial.test.ts, sibling to fees.test.ts). Used both server-side (`createStripeCheckout`'s
// `[min, balance]` validation) and to pre-compute `PublicInvoicePayload.minPaymentAmount` so the
// client never re-derives the percent math.

/** Result of {@link resolvePartialPaymentBounds}. */
export interface PartialPaymentBounds {
  /** Integer cents — the smallest amount a customer may submit. */
  min: number
  /** Integer cents — the current balance, i.e. the largest amount a customer may submit. */
  max: number
}

/**
 * Resolve the `[min, max]` a partial payment must fall within, given the invoice's current
 * `balance` (integer cents) and the org's `documents.invoice.partialPaymentMinPercent` setting.
 * `min` is `Math.ceil(balance * minPercent / 100)`, clamped to `[0, balance]` — ceil rather than
 * round/floor so the minimum never rounds DOWN below the configured percent (e.g. 10% of a
 * single cent should never resolve to a 0-cent minimum). `max` is always the balance as-is.
 */
export function resolvePartialPaymentBounds(
  balance: number,
  minPercent: number
): PartialPaymentBounds {
  const rawMin = Math.ceil((balance * minPercent) / 100)
  const min = Math.max(0, Math.min(rawMin, balance))
  return { min, max: balance }
}
