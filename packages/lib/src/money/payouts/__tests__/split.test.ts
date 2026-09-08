// packages/lib/src/money/payouts/__tests__/split.test.ts
//
// The load-bearing property here is that recognition is keyed on the CHARGE ID
// and never on the amount. Two charges for the same amount on one day are
// ordinary, and matching on the number would pair the wrong one while both
// sides still balanced - so nothing downstream would ever surface it.

import { describe, expect, it } from 'vitest'
import { type PayoutItem, resolvePayoutStatus, splitPayout } from '../client'

function charge(id: string, gross: number, fee: number): PayoutItem {
  return { id: `txn_${id}`, chargeId: `ch_${id}`, grossMinor: gross, feeMinor: fee }
}

describe('splitPayout', () => {
  it('puts everything on the recognised side when every charge is known', () => {
    const split = splitPayout(
      [charge('a', 100_000, 3_200), charge('b', 50_000, 1_750)],
      new Set(['ch_a', 'ch_b'])
    )

    expect(split).toEqual({
      grossMinor: 150_000,
      feesMinor: 4_950,
      netMinor: 145_050,
      unrecognisedNetMinor: 0,
      unrecognisedCount: 0,
    })
  })

  it('sends an unknown charge to the unrecognised side NET, not gross', () => {
    // The fee on money auxx never took is not auxx's processing fee: it is
    // embedded in the remainder and sorted out when the receipt is attributed.
    const split = splitPayout(
      [charge('a', 100_000, 3_200), charge('b', 60_000, 2_000)],
      new Set(['ch_a'])
    )

    expect(split.grossMinor).toBe(100_000)
    expect(split.feesMinor).toBe(3_200)
    expect(split.unrecognisedNetMinor).toBe(58_000)
    expect(split.unrecognisedCount).toBe(1)
  })

  it('treats a balance transaction with no charge as unrecognised', () => {
    // A Stripe monthly fee, an adjustment, a transfer - nothing auxx could hold
    // a PaymentTransaction for.
    const split = splitPayout(
      [
        charge('a', 100_000, 3_200),
        { id: 'txn_fee', chargeId: null, grossMinor: -2_500, feeMinor: 0 },
      ],
      new Set(['ch_a'])
    )

    expect(split.unrecognisedNetMinor).toBe(-2_500)
    expect(split.unrecognisedCount).toBe(1)
  })

  it('keeps a refund on the same side as its charge', () => {
    const split = splitPayout(
      [
        charge('a', 100_000, 3_200),
        { id: 'txn_r', chargeId: 'ch_a', grossMinor: -40_000, feeMinor: 0 },
      ],
      new Set(['ch_a'])
    )

    expect(split.grossMinor).toBe(60_000)
    expect(split.unrecognisedNetMinor).toBe(0)
  })

  it('recognises nothing, without erroring, on an org that just connected', () => {
    const split = splitPayout([charge('a', 100_000, 3_200)], new Set())

    expect(split.grossMinor).toBe(0)
    expect(split.netMinor).toBe(0)
    expect(split.unrecognisedNetMinor).toBe(96_800)
    expect(split.unrecognisedCount).toBe(1)
  })

  // 🛑 The reason the split keys on the id.
  it('does not pair two same-amount charges by their amount', () => {
    const split = splitPayout(
      [charge('known', 25_000, 900), charge('unknown', 25_000, 900)],
      new Set(['ch_known'])
    )

    expect(split.grossMinor).toBe(25_000)
    expect(split.unrecognisedNetMinor).toBe(24_100)
    expect(split.unrecognisedCount).toBe(1)
  })

  it('is empty for a payout with no items', () => {
    expect(splitPayout([], new Set())).toEqual({
      grossMinor: 0,
      feesMinor: 0,
      netMinor: 0,
      unrecognisedNetMinor: 0,
      unrecognisedCount: 0,
    })
  })
})

describe('resolvePayoutStatus', () => {
  it('passes a known status through', () => {
    expect(resolvePayoutStatus('paid')).toBe('paid')
    expect(resolvePayoutStatus('reversed')).toBe('reversed')
  })

  it('defaults an unknown or absent value to what a fresh row gets', () => {
    expect(resolvePayoutStatus(null)).toBe('in_transit')
    expect(resolvePayoutStatus(undefined)).toBe('in_transit')
    expect(resolvePayoutStatus('nonsense')).toBe('in_transit')
  })
})
