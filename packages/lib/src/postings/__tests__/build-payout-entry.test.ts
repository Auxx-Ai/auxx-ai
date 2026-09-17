// packages/lib/src/postings/__tests__/build-payout-entry.test.ts
//
// The load-bearing test in this file is the one that refuses
// `gross !== net + fees`. Every other builder here computes its own totals; a
// payout TRANSCRIBES three numbers a gateway reported, and balancing them by
// deriving one from the other two would silently correct the gateway's
// arithmetic - which is the one thing that makes a rail's clearing account
// impossible to reconcile to zero for reasons nobody can reconstruct.

import { describe, expect, it } from 'vitest'
import { UnprocessableEntityError } from '../../errors'
import { ACCOUNT_ROLES } from '../build-entry'
import { buildPayoutEntry, PAYOUT_SOURCE_TYPE } from '../build-payout-entry'
import { buildDocNumber } from '../doc-number'

const RAIL = 'gateway_1'
const CURRENCY = 'USD'
const SCOPE = { rail: RAIL, currency: CURRENCY }

const BASE = {
  payoutId: 'po_1AbCdEfGhIjKlMnOpQrStUvW',
  payoutNumber: 'PO-0007',
  rail: RAIL,
  currency: CURRENCY,
  grossMinor: 500_000,
  feesMinor: 14_800,
  netMinor: 485_200,
  paidAt: '2026-09-04',
}

function line(entry: ReturnType<typeof buildPayoutEntry>['entry'], role: string) {
  return entry.lines.find((row) => row.accountRole === role)
}

describe('the entry', () => {
  it('debits bank net, debits fees, and credits clearing gross - every leg a role line', () => {
    const built = buildPayoutEntry(BASE)

    expect(line(built.entry, ACCOUNT_ROLES.BANK)).toMatchObject({
      direction: 'debit',
      amount: 485_200,
      sourceScope: SCOPE,
    })
    expect(line(built.entry, ACCOUNT_ROLES.PAYMENT_PROCESSING_FEES)).toMatchObject({
      direction: 'debit',
      amount: 14_800,
      sourceScope: SCOPE,
    })
    expect(line(built.entry, ACCOUNT_ROLES.CLEARING)).toMatchObject({
      direction: 'credit',
      amount: 500_000,
      sourceScope: SCOPE,
    })
    expect(built.entry.totalDebit).toBe(built.entry.totalCredit)
    expect(built.entry.postingType).toBe('payout')
  })

  it('names every line by role, never by a gl_account id', () => {
    const built = buildPayoutEntry(BASE)
    for (const row of built.entry.lines) {
      expect(row.accountRole).toBeDefined()
      expect(row.glAccountId).toBeUndefined()
      expect(row.accountRole).not.toBe('cash')
    }
  })

  it('keys the period on the payout number, never on a date', () => {
    // Two payouts can settle on one day; a date key merges them into one entry
    // whose total ties to neither deposit.
    const built = buildPayoutEntry(BASE)
    expect(built.periodKey).toBe('PO-0007')
    expect(buildDocNumber({ postingType: 'payout', periodKey: built.periodKey })).toBe(
      'AUXX-PAY-PO0007'
    )
  })

  it('sources every line on the payout id', () => {
    const built = buildPayoutEntry(BASE)
    for (const row of built.entry.lines) {
      expect(row.sourceType).toBe(PAYOUT_SOURCE_TYPE)
      expect(row.sourceId).toBe(BASE.payoutId)
    }
  })

  it('drops a zero fee leg rather than posting to an unmapped role', () => {
    const built = buildPayoutEntry({ ...BASE, feesMinor: 0, netMinor: 500_000 })
    expect(line(built.entry, ACCOUNT_ROLES.PAYMENT_PROCESSING_FEES)).toBeUndefined()
    expect(built.entry.lines).toHaveLength(2)
  })
})

describe('refusals', () => {
  it('refuses gross !== net + fees, naming the difference', () => {
    expect(() => buildPayoutEntry({ ...BASE, netMinor: 485_100 })).toThrowError(
      /does not add up.*off by 100/s
    )
  })

  it('refuses a fractional amount', () => {
    expect(() => buildPayoutEntry({ ...BASE, feesMinor: 148.5 })).toThrowError(
      /whole number of cents/
    )
  })

  it('refuses a negative fee or net - direction carries the sign', () => {
    expect(() => buildPayoutEntry({ ...BASE, feesMinor: -14_800, netMinor: 514_800 })).toThrowError(
      /positive amounts/
    )
  })

  it('refuses a payout that settles nothing', () => {
    expect(() =>
      buildPayoutEntry({ ...BASE, grossMinor: 0, feesMinor: 0, netMinor: 0 })
    ).toThrowError(/moves nothing/)
  })

  it('refuses a bare gateway id as the key, naming the length', () => {
    expect(() => buildPayoutEntry({ ...BASE, payoutNumber: BASE.payoutId })).toThrowError(
      /compacts to 27 characters/
    )
  })

  it('refuses a blank payout number', () => {
    expect(() => buildPayoutEntry({ ...BASE, payoutNumber: '  ' })).toThrowError(
      UnprocessableEntityError
    )
  })

  // task 58 §5.3: a payout without a rail cannot exist - it was read by a
  // source that is linked to one.
  it('refuses a missing rail', () => {
    expect(() => buildPayoutEntry({ ...BASE, rail: '' })).toThrowError(/has no rail/)
  })

  it('refuses a blank rail', () => {
    expect(() => buildPayoutEntry({ ...BASE, rail: '   ' })).toThrowError(UnprocessableEntityError)
  })

  it('refuses a missing settlement currency', () => {
    expect(() => buildPayoutEntry({ ...BASE, currency: '' })).toThrowError(/no settlement currency/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// The fourth leg: charges the payout settled that auxx never posted to clearing
// ─────────────────────────────────────────────────────────────────────────────

describe('the unrecognised remainder', () => {
  it('is absent from an entry that recognises everything', () => {
    const built = buildPayoutEntry(BASE)
    expect(line(built.entry, ACCOUNT_ROLES.UNIDENTIFIED_RECEIPTS)).toBeUndefined()
    expect(built.unrecognisedNetMinor).toBe(0)
    expect(built.depositedMinor).toBe(485_200)
  })

  it('is dropped rather than posted at zero when passed explicitly', () => {
    const built = buildPayoutEntry({ ...BASE, unrecognisedNetMinor: 0 })
    expect(built.entry.lines).toHaveLength(3)
  })

  it('credits unidentified receipts and leaves clearing relieved of only what auxx took', () => {
    // The merchant took $600 outside auxx in the same payout, $580 of it net.
    const built = buildPayoutEntry({ ...BASE, unrecognisedNetMinor: 58_000 })

    expect(line(built.entry, ACCOUNT_ROLES.CLEARING)).toMatchObject({
      direction: 'credit',
      amount: 500_000,
    })
    expect(line(built.entry, ACCOUNT_ROLES.UNIDENTIFIED_RECEIPTS)).toMatchObject({
      direction: 'credit',
      amount: 58_000,
      sourceScope: SCOPE,
    })
    expect(line(built.entry, ACCOUNT_ROLES.PAYMENT_PROCESSING_FEES)).toMatchObject({
      direction: 'debit',
      amount: 14_800,
    })
  })

  it('debits the bank account the WHOLE deposit, which is what the bank line shows', () => {
    const built = buildPayoutEntry({ ...BASE, unrecognisedNetMinor: 58_000 })

    expect(line(built.entry, ACCOUNT_ROLES.BANK)).toMatchObject({
      direction: 'debit',
      amount: 543_200,
    })
    expect(built.depositedMinor).toBe(543_200)
  })

  it('still balances with the fourth leg', () => {
    const built = buildPayoutEntry({ ...BASE, unrecognisedNetMinor: 58_000 })
    expect(built.entry.totalDebit).toBe(built.entry.totalCredit)
    // 543,200 bank account + 14,800 fees = 500,000 clearing + 58,000 unidentified.
    expect(built.entry.totalDebit).toBe(558_000)
  })

  it('sources the fourth leg on the payout id like every other line', () => {
    const built = buildPayoutEntry({ ...BASE, unrecognisedNetMinor: 58_000 })
    expect(line(built.entry, ACCOUNT_ROLES.UNIDENTIFIED_RECEIPTS)).toMatchObject({
      sourceType: PAYOUT_SOURCE_TYPE,
      sourceId: BASE.payoutId,
    })
  })

  // 🛑 The refusal that matters. A negative remainder means auxx thinks it took
  // more than the gateway settled - a mis-read payout or a double-posted charge.
  // Clamping to zero would post a plausible entry over either.
  it('refuses a negative remainder rather than clamping it', () => {
    expect(() => buildPayoutEntry({ ...BASE, unrecognisedNetMinor: -1 })).toThrow(
      UnprocessableEntityError
    )
    expect(() => buildPayoutEntry({ ...BASE, unrecognisedNetMinor: -1 })).toThrow(
      /recognised MORE than the gateway settled/
    )
  })

  it('refuses a fractional remainder', () => {
    expect(() => buildPayoutEntry({ ...BASE, unrecognisedNetMinor: 12.5 })).toThrow(
      UnprocessableEntityError
    )
  })

  // The gross/net/fees refusal is about the RECOGNISED three, and the remainder
  // sits outside it - otherwise every payout with an outside charge would be
  // refused as not adding up.
  it('does not fold the remainder into the gross = net + fees check', () => {
    expect(() => buildPayoutEntry({ ...BASE, unrecognisedNetMinor: 58_000 })).not.toThrow()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// brief 26 §4: `feeTreatment`. A billed rail deposits GROSS.
// ─────────────────────────────────────────────────────────────────────────────

describe('a billed rail', () => {
  const BILLED = {
    ...BASE,
    feeTreatment: 'billed' as const,
    grossMinor: 500_000,
    feesMinor: 0,
    netMinor: 500_000,
  }

  it('has THREE legs, not four, and gross === net passes rather than refusing', () => {
    const built = buildPayoutEntry({ ...BILLED, unrecognisedNetMinor: 58_000 })

    expect(built.entry.lines).toHaveLength(3)
    expect(line(built.entry, ACCOUNT_ROLES.PAYMENT_PROCESSING_FEES)).toBeUndefined()
    expect(line(built.entry, ACCOUNT_ROLES.BANK)).toMatchObject({
      direction: 'debit',
      amount: 558_000,
    })
    expect(line(built.entry, ACCOUNT_ROLES.CLEARING)).toMatchObject({
      direction: 'credit',
      amount: 500_000,
    })
    expect(line(built.entry, ACCOUNT_ROLES.UNIDENTIFIED_RECEIPTS)).toMatchObject({
      direction: 'credit',
      amount: 58_000,
    })
    expect(built.entry.totalDebit).toBe(built.entry.totalCredit)
  })

  it('books no fee leg even on a billed rail', () => {
    // There is no fee IN THIS SETTLEMENT to post at any amount - the acquirer
    // bills for it later.
    const built = buildPayoutEntry(BILLED)
    expect(built.entry.lines).toHaveLength(2)
  })

  it('refuses a withheld fee, because a billed rail deposits gross', () => {
    expect(() => buildPayoutEntry({ ...BASE, feeTreatment: 'billed' })).toThrowError(
      /bills its fees separately/
    )
  })

  it('defaults to netted, so an unset treatment is exactly today', () => {
    const withDefault = buildPayoutEntry(BASE)
    const explicit = buildPayoutEntry({ ...BASE, feeTreatment: 'netted' })
    expect(withDefault.entry.lines).toEqual(explicit.entry.lines)
  })
})
