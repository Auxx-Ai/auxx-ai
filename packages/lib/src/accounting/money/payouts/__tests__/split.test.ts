// packages/lib/src/accounting/money/payouts/__tests__/split.test.ts
//
// The load-bearing property here is that recognition is keyed on the item's
// `ref.id` and never on the amount. Two charges for the same amount on one day
// are ordinary, and matching on the number would pair the wrong one while both
// sides still balanced - so nothing downstream would ever surface it.
//
// Since brief 27 unit 2 the split does not know WHICH lookup produced an id
// (`recognise.ts` does, per `ref.kind`); it only asks whether the id is in the
// set, and a `none` ref is never in it.

import { describe, expect, it } from 'vitest'
import { type PayoutItem, resolvePayoutStatus, splitPayout, totalsOnlySplit } from '../client'

function charge(id: string, gross: number, fee: number): PayoutItem {
  return {
    externalId: `txn_${id}`,
    grossMinor: gross,
    feeMinor: fee,
    ref: { kind: 'stripe_charge', id: `ch_${id}` },
  }
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

  it('treats an item with a `none` ref as unrecognised, whatever the set holds', () => {
    // A Stripe monthly fee, an adjustment, a transfer - nothing auxx could hold
    // a record for. Not even a set that somehow contained its external id
    // would recognise it: there is no `ref.id` to look up.
    const split = splitPayout(
      [
        charge('a', 100_000, 3_200),
        { externalId: 'txn_fee', grossMinor: -2_500, feeMinor: 0, ref: { kind: 'none' } },
      ],
      new Set(['ch_a', 'txn_fee'])
    )

    expect(split.unrecognisedNetMinor).toBe(-2_500)
    expect(split.unrecognisedCount).toBe(1)
  })

  it('keeps a refund on the same side as its charge', () => {
    const split = splitPayout(
      [
        charge('a', 100_000, 3_200),
        {
          externalId: 'txn_r',
          grossMinor: -40_000,
          feeMinor: 0,
          ref: { kind: 'stripe_charge', id: 'ch_a' },
        },
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

// ─────────────────────────────────────────────────────────────────────────────
// brief 27 §4 rule 2 / §13 test 3: a source with totals and no items posts
// recognition equal to gross, with nothing on the unrecognised side.
// ─────────────────────────────────────────────────────────────────────────────

describe('totalsOnlySplit', () => {
  it('fills gross and fees from the totals and leaves the remainder at zero by construction', () => {
    expect(totalsOnlySplit({ grossMinor: 150_000, feesMinor: 4_950 })).toEqual({
      grossMinor: 150_000,
      feesMinor: 4_950,
      netMinor: 145_050,
      unrecognisedNetMinor: 0,
      unrecognisedCount: 0,
    })
  })

  it('agrees with splitPayout over the same numbers when every item is recognised', () => {
    // The two paths must land on the same four numbers for the entry, or an
    // imported statement and a synced feed of the same payout would post
    // differently.
    const itemised = splitPayout(
      [charge('a', 100_000, 3_200), charge('b', 50_000, 1_750)],
      new Set(['ch_a', 'ch_b'])
    )
    expect(totalsOnlySplit({ grossMinor: 150_000, feesMinor: 4_950 })).toEqual(itemised)
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
