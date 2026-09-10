// packages/lib/src/postings/__tests__/build-payout-entry.test.ts
//
// The load-bearing test in this file is the one that refuses
// `gross !== net + fees`. Every other builder here computes its own totals; a
// payout TRANSCRIBES three numbers a gateway reported, and balancing them by
// deriving one from the other two would silently correct the gateway's
// arithmetic - which is the one thing that makes `1200 Card Clearing`
// impossible to reconcile to zero for reasons nobody can reconstruct.

import { describe, expect, it } from 'vitest'
import { UnprocessableEntityError } from '../../errors'
import { ACCOUNT_ROLES } from '../build-entry'
import { buildPayoutEntry, PAYOUT_SOURCE_TYPE } from '../build-payout-entry'
import { buildDocNumber } from '../doc-number'

const BASE = {
  payoutId: 'po_1AbCdEfGhIjKlMnOpQrStUvW',
  payoutNumber: 'PO-0007',
  bankAccountGlAccountId: 'gl-1000',
  grossMinor: 500_000,
  feesMinor: 14_800,
  netMinor: 485_200,
  clearingRole: ACCOUNT_ROLES.CLEARING_CARD,
  paidAt: '2026-09-04',
}

function line(entry: ReturnType<typeof buildPayoutEntry>['entry'], role: string) {
  return entry.lines.find((row) => row.accountRole === role)
}

/** The bank-account debit leg, named by `glAccountId` - never a role (brief 13 §2). */
function bankLine(entry: ReturnType<typeof buildPayoutEntry>['entry']) {
  return entry.lines.find((row) => row.glAccountId === BASE.bankAccountGlAccountId)
}

describe('the entry', () => {
  it('debits the settlement bank account net, debits fees, and credits clearing gross', () => {
    const built = buildPayoutEntry(BASE)

    expect(bankLine(built.entry)).toMatchObject({
      direction: 'debit',
      amount: 485_200,
    })
    expect(line(built.entry, ACCOUNT_ROLES.PAYMENT_PROCESSING_FEES)).toMatchObject({
      direction: 'debit',
      amount: 14_800,
    })
    expect(line(built.entry, ACCOUNT_ROLES.CLEARING_CARD)).toMatchObject({
      direction: 'credit',
      amount: 500_000,
    })
    expect(built.entry.totalDebit).toBe(built.entry.totalCredit)
    expect(built.entry.postingType).toBe('payout')
  })

  it('names the bank account by id, never by the retired cash role', () => {
    const built = buildPayoutEntry(BASE)
    expect(bankLine(built.entry)?.accountRole).toBeUndefined()
    for (const row of built.entry.lines) {
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

  it('refuses a missing bank account, naming the remedy', () => {
    expect(() => buildPayoutEntry({ ...BASE, bankAccountGlAccountId: '' })).toThrowError(
      /no bank account to debit/
    )
  })

  it('refuses a blank bank account id', () => {
    expect(() => buildPayoutEntry({ ...BASE, bankAccountGlAccountId: '   ' })).toThrowError(
      UnprocessableEntityError
    )
  })

  it('refuses a role that is not a clearing account', () => {
    // Affirm-gateway settlements are invisible to the payouts API, so `1200`
    // can never reconcile if they are folded into it - one payout drains ONE
    // clearing account, and this is the guard that says which.
    expect(() =>
      buildPayoutEntry({ ...BASE, clearingRole: ACCOUNT_ROLES.ACCOUNTS_RECEIVABLE })
    ).toThrowError(/not a clearing account/)
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

    expect(line(built.entry, ACCOUNT_ROLES.CLEARING_CARD)).toMatchObject({
      direction: 'credit',
      amount: 500_000,
    })
    expect(line(built.entry, ACCOUNT_ROLES.UNIDENTIFIED_RECEIPTS)).toMatchObject({
      direction: 'credit',
      amount: 58_000,
    })
    expect(line(built.entry, ACCOUNT_ROLES.PAYMENT_PROCESSING_FEES)).toMatchObject({
      direction: 'debit',
      amount: 14_800,
    })
  })

  it('debits the bank account the WHOLE deposit, which is what the bank line shows', () => {
    const built = buildPayoutEntry({ ...BASE, unrecognisedNetMinor: 58_000 })

    expect(bankLine(built.entry)).toMatchObject({
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
