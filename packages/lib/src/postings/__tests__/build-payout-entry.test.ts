// packages/lib/src/postings/__tests__/build-payout-entry.test.ts
//
// The load-bearing test in this file is the one that refuses
// `gross !== net + fees`. Every other builder here computes its own totals; a
// payout TRANSCRIBES three numbers a gateway reported, and balancing them by
// deriving one from the other two would silently correct the gateway's
// arithmetic - which is the one thing that makes `1200 Shopify Clearing`
// impossible to reconcile to zero for reasons nobody can reconstruct.

import { describe, expect, it } from 'vitest'
import { UnprocessableEntityError } from '../../errors'
import { ACCOUNT_ROLES } from '../build-entry'
import { buildPayoutEntry, PAYOUT_SOURCE_TYPE } from '../build-payout-entry'
import { buildDocNumber } from '../doc-number'

const BASE = {
  payoutId: 'po_1AbCdEfGhIjKlMnOpQrStUvW',
  payoutNumber: 'PO-0007',
  grossMinor: 500_000,
  feesMinor: 14_800,
  netMinor: 485_200,
  clearingRole: ACCOUNT_ROLES.CLEARING_SHOPIFY,
  paidAt: '2026-09-04',
}

function line(entry: ReturnType<typeof buildPayoutEntry>['entry'], role: string) {
  return entry.lines.find((row) => row.accountRole === role)
}

describe('the entry', () => {
  it('debits cash net, debits fees, and credits clearing gross', () => {
    const built = buildPayoutEntry(BASE)

    expect(line(built.entry, ACCOUNT_ROLES.CASH)).toMatchObject({
      direction: 'debit',
      amount: 485_200,
    })
    expect(line(built.entry, ACCOUNT_ROLES.PAYMENT_PROCESSING_FEES)).toMatchObject({
      direction: 'debit',
      amount: 14_800,
    })
    expect(line(built.entry, ACCOUNT_ROLES.CLEARING_SHOPIFY)).toMatchObject({
      direction: 'credit',
      amount: 500_000,
    })
    expect(built.entry.totalDebit).toBe(built.entry.totalCredit)
    expect(built.entry.postingType).toBe('payout')
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

  it('refuses a role that is not a clearing account', () => {
    // Affirm-gateway settlements are invisible to the payouts API, so `1200`
    // can never reconcile if they are folded into it - one payout drains ONE
    // clearing account, and this is the guard that says which.
    expect(() => buildPayoutEntry({ ...BASE, clearingRole: ACCOUNT_ROLES.CASH })).toThrowError(
      /not a clearing account/
    )
  })
})
