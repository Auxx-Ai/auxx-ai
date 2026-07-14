// packages/lib/src/money/payments/deposit.test.ts

import { describe, expect, it } from 'vitest'
import { computeDepositAmount } from './deposit'

// Amounts are integer cents (the MQ1 storage convention) — e.g. 10_000 = $100.00. Only the
// pure `computeDepositAmount` is unit-tested here — `resolveQuoteDeposit` hits the DB/org
// settings and isn't covered by this file (mirrors fees.test.ts's no-mocking-needed shape).

describe('computeDepositAmount', () => {
  it('computes a percent-of-total deposit', () => {
    // 20% of $100.00 = $20.00
    expect(computeDepositAmount(10_000, 'percent', 20)).toBe(2_000)
  })

  it('converts a fixed deposit from currency units to cents', () => {
    // $25 fixed deposit on a $100.00 quote = 2,500 cents
    expect(computeDepositAmount(10_000, 'fixed', 25)).toBe(2_500)
  })

  it('handles a decimal fixed deposit', () => {
    // $49.99 → 4,999 cents
    expect(computeDepositAmount(10_000, 'fixed', 49.99)).toBe(4_999)
  })

  it('returns 0 for depositType "none"', () => {
    expect(computeDepositAmount(10_000, 'none', 20)).toBe(0)
  })

  it('returns 0 when depositType is unset', () => {
    expect(computeDepositAmount(10_000, null, 20)).toBe(0)
    expect(computeDepositAmount(10_000, undefined, 20)).toBe(0)
  })

  it('returns 0 when depositValue is unset/falsy', () => {
    expect(computeDepositAmount(10_000, 'percent', null)).toBe(0)
    expect(computeDepositAmount(10_000, 'percent', undefined)).toBe(0)
    expect(computeDepositAmount(10_000, 'percent', 0)).toBe(0)
  })

  it('clamps a percent deposit above 100% down to the total', () => {
    expect(computeDepositAmount(10_000, 'percent', 150)).toBe(10_000)
  })

  it('clamps a fixed deposit above the total down to the total', () => {
    // $500 fixed deposit on a $100.00 quote clamps to the total
    expect(computeDepositAmount(10_000, 'fixed', 500)).toBe(10_000)
  })

  it('clamps a negative fixed deposit to 0', () => {
    expect(computeDepositAmount(10_000, 'fixed', -5)).toBe(0)
  })

  it('rounds to the nearest cent on a percent split', () => {
    // 33.33% of $100.00 (10,000 cents) = 3333.33 → 3333
    expect(computeDepositAmount(10_000, 'percent', 33.33)).toBe(3_333)
  })

  it('rounds a half-cent case up (banker rounding not used — Math.round)', () => {
    // 50% of 3 cents = 1.5 → rounds to 2
    expect(computeDepositAmount(3, 'percent', 50)).toBe(2)
  })
})
