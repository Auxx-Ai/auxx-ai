// packages/lib/src/money/customer-money/partial-payment.ts
// Partial-payment amount bounds for the public pay page's custom-amount support and its
// test-plan extraction. Pure function — no DB access. Moved out of the legacy `payments/`
// lane (accounting migration step 0): the bounds math itself is not Stripe- or
// PaymentTransaction-specific, and `public-token.ts` still shows the minimum a customer may
// pay even though the Checkout button behind it is gone.

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
