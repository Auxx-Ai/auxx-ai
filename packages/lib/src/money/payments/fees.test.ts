// packages/lib/src/money/payments/fees.test.ts

import { describe, expect, it } from 'vitest'
import { resolveApplicationFee } from './fees'

// Amounts are integer cents (the MQ1 storage convention) — e.g. 10_000 = $100.00.
// `PAYMENTS_APPLICATION_FEE_PERCENT` has a registry default of '2' and no env var is set
// under vitest, so `configService.get()` resolves that default synchronously (no mocking
// needed) whenever `paymentAccount` doesn't carry a per-org override.

describe('resolveApplicationFee', () => {
  it('applies the 2% global default when there is no PaymentAccount override', () => {
    // 2% of $100.00 = $2.00
    expect(resolveApplicationFee(null, 10_000)).toBe(200)
    expect(resolveApplicationFee({ applicationFeePercent: null }, 10_000)).toBe(200)
  })

  it('rounds to the nearest cent', () => {
    // 2% of $33.33 (3333 cents) = 66.66 → 67
    expect(resolveApplicationFee(null, 3_333)).toBe(67)
  })

  it('prefers the per-org override percent when set', () => {
    // 5% of $100.00 = $5.00
    expect(resolveApplicationFee({ applicationFeePercent: '5' }, 10_000)).toBe(500)
    // A 0% override disables the fee entirely
    expect(resolveApplicationFee({ applicationFeePercent: '0' }, 10_000)).toBe(0)
  })

  it('clamps the fee to zero for a zero or negative amount', () => {
    expect(resolveApplicationFee(null, 0)).toBe(0)
    expect(resolveApplicationFee(null, -100)).toBe(0)
  })

  it('never lets the fee exceed the payment amount, even with an extreme override', () => {
    // 500% override on a $1.00 payment would be 500 cents — clamped down to the 100-cent amount.
    expect(resolveApplicationFee({ applicationFeePercent: '500' }, 100)).toBe(100)
  })

  it('rounds a tiny invoice down to a zero fee rather than blocking the payment', () => {
    // 2% of 1 cent = 0.02 → rounds to 0, not negative, not blocking.
    expect(resolveApplicationFee(null, 1)).toBe(0)
  })
})
