// packages/lib/src/money/payouts/application-fee.ts
// Application fee resolution for the payouts rail. Pure function — no Stripe import, no DB
// access. Moved out of the legacy `payments/` lane (accounting migration step 0): the platform
// fee it resolves is the Connect payout's own fee, not a charge-collection concern.

import { configService } from '@auxx/credentials'

/** The minimal `PaymentAccount` shape `resolveApplicationFee` needs. */
export interface PaymentAccountFeeInput {
  /** Per-org override percent (e.g. `'1.5'`), or `null` to fall back to the global default. */
  applicationFeePercent: string | null
}

/**
 * Resolve the platform application fee for a charge, in minor units (integer cents). The
 * per-org `PaymentAccount.applicationFeePercent` override wins when set; otherwise falls back
 * to `PAYMENTS_APPLICATION_FEE_PERCENT` (default `'2'`, i.e. 2%). The result is always clamped
 * to `[0, amount]` — a tiny invoice rounds the fee to 0 rather than ever blocking the payment.
 */
export function resolveApplicationFee(
  paymentAccount: PaymentAccountFeeInput | null,
  amount: number
): number {
  const pct = Number(
    paymentAccount?.applicationFeePercent ??
      configService.get<string>('PAYMENTS_APPLICATION_FEE_PERCENT') ??
      '2'
  )
  const fee = Math.round((amount * pct) / 100)
  return Math.max(0, Math.min(fee, amount))
}
