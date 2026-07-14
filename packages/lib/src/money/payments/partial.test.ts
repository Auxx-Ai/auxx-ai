// packages/lib/src/money/payments/partial.test.ts

import { describe, expect, it } from 'vitest'
import { resolvePartialPaymentBounds } from './partial'

// Amounts are integer cents (the MQ1 storage convention) — e.g. 10_000 = $100.00. Only the
// pure `resolvePartialPaymentBounds` is unit-tested here (mirrors fees.test.ts's
// no-mocking-needed shape).

describe('resolvePartialPaymentBounds', () => {
  it('resolves a 10% minimum on a normal balance', () => {
    // 10% of $100.00 (10,000 cents) = 1,000 cents
    expect(resolvePartialPaymentBounds(10_000, 10)).toEqual({ min: 1_000, max: 10_000 })
  })

  it('resolves a 0-cent minimum when the percent is 0', () => {
    expect(resolvePartialPaymentBounds(10_000, 0)).toEqual({ min: 0, max: 10_000 })
  })

  it('clamps a 100%+ minimum down to the balance', () => {
    expect(resolvePartialPaymentBounds(10_000, 100)).toEqual({ min: 10_000, max: 10_000 })
    expect(resolvePartialPaymentBounds(10_000, 150)).toEqual({ min: 10_000, max: 10_000 })
  })

  it('handles a tiny balance without a negative or over-balance minimum', () => {
    // 10% of 1 cent = 0.1 → ceil'd to 1 cent, still within [0, 1]
    expect(resolvePartialPaymentBounds(1, 10)).toEqual({ min: 1, max: 1 })
  })

  it('resolves a 0-cent balance to a 0-cent minimum', () => {
    expect(resolvePartialPaymentBounds(0, 10)).toEqual({ min: 0, max: 0 })
  })

  it('rounds the minimum UP (ceil), never letting it round below the configured percent', () => {
    // 10% of $33.33 (3,333 cents) = 333.3 → ceil's to 334
    expect(resolvePartialPaymentBounds(3_333, 10)).toEqual({ min: 334, max: 3_333 })
  })

  it('clamps a negative percent to a 0-cent minimum', () => {
    expect(resolvePartialPaymentBounds(10_000, -5)).toEqual({ min: 0, max: 10_000 })
  })
})
