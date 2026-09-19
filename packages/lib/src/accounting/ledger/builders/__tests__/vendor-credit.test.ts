// packages/lib/src/accounting/ledger/builders/__tests__/vendor-credit.test.ts
//
// The expense bill's entry with the sides flipped, so the four things worth
// pinning are its four with the signs reversed:
//
//  1. **The A/P line is a DEBIT and is the only line carrying the vendor.** A
//     credit that debited nothing relieves no payable, and QuickBooks refuses an
//     `accounts_payable` line with no counterparty.
//  2. **An uncoded line REFUSES, naming the line.** There is no default account
//     to give money back to.
//  3. **The entry ties to the stored total or it does not post.**
//  4. **One builder covers the GRNI case.** A short-shipment credit is this
//     entry with the org's GRNI account on the line, and nothing else changes.

import { describe, expect, it } from 'vitest'
import { UnprocessableEntityError } from '../../../../errors'
import { ACCOUNT_ROLES } from '../entry'
import {
  buildVendorCreditEntry,
  VENDOR_CREDIT_POSTING_TYPE,
  VENDOR_CREDIT_SOURCE_TYPE,
} from '../vendor-credit'

const VENDOR = 'ei_company_supplier'

const BASE = {
  vendorCreditId: 'ei_credit_1',
  number: 'VC-0001',
  issuedAt: '2026-09-18',
  currency: 'USD',
  ledgerCurrency: 'USD',
  vendorCompanyInstanceId: VENDOR,
}

describe('buildVendorCreditEntry', () => {
  it('debits the payable once and credits each coded line', () => {
    const built = buildVendorCreditEntry({
      ...BASE,
      total: 30_000,
      lines: [
        { lineId: 'l1', glAccountId: 'ei_acct_rent', amount: 20_000, description: 'Rent credit' },
        { lineId: 'l2', glAccountId: 'ei_acct_freight', amount: 10_000, description: 'Freight' },
      ],
    })

    expect(built.periodKey).toBe('VC-0001')
    expect(built.totalMinor).toBe(30_000)
    expect(built.entry.postingType).toBe(VENDOR_CREDIT_POSTING_TYPE)
    expect(built.entry.txnDate).toBe('2026-09-18')

    const [payable, ...credits] = built.entry.lines
    expect(payable).toMatchObject({
      sourceType: VENDOR_CREDIT_SOURCE_TYPE,
      sourceId: 'ei_credit_1',
      accountRole: ACCOUNT_ROLES.ACCOUNTS_PAYABLE,
      direction: 'debit',
      amount: 30_000,
      counterpartyType: 'vendor',
      counterpartyId: VENDOR,
    })
    expect(credits.map((line) => [line.glAccountId, line.direction, line.amount])).toEqual([
      ['ei_acct_rent', 'credit', 20_000],
      ['ei_acct_freight', 'credit', 10_000],
    ])
    // Only the payable leg names the vendor.
    for (const line of credits) expect(line.counterpartyId).toBeUndefined()
  })

  it('is the same entry for a short shipment, with GRNI on the line', () => {
    const built = buildVendorCreditEntry({
      ...BASE,
      total: 20_000,
      lines: [
        { lineId: 'l1', glAccountId: 'ei_acct_grni', amount: 20_000, description: 'Short 2' },
      ],
    })
    expect(built.entry.lines).toHaveLength(2)
    expect(built.entry.lines[1]).toMatchObject({
      glAccountId: 'ei_acct_grni',
      direction: 'credit',
      amount: 20_000,
    })
  })

  it('refuses an uncoded line, naming it', () => {
    expect(() =>
      buildVendorCreditEntry({
        ...BASE,
        total: 10_000,
        lines: [{ lineId: 'l1', glAccountId: null, amount: 10_000, description: 'Unallocated' }],
      })
    ).toThrow(/Unallocated/)
  })

  it('refuses when the coded lines do not sum to the stored total', () => {
    expect(() =>
      buildVendorCreditEntry({
        ...BASE,
        total: 30_000,
        lines: [{ lineId: 'l1', glAccountId: 'ei_acct_rent', amount: 20_000 }],
      })
    ).toThrow(/difference of 10000/)
  })

  it('refuses a non-positive total — a further charge is a bill, not a negative credit', () => {
    expect(() =>
      buildVendorCreditEntry({
        ...BASE,
        total: 0,
        lines: [{ lineId: 'l1', glAccountId: 'ei_acct_rent', amount: 0 }],
      })
    ).toThrow(UnprocessableEntityError)
  })

  it('refuses a currency the ledger is not kept in', () => {
    expect(() =>
      buildVendorCreditEntry({
        ...BASE,
        currency: 'EUR',
        total: 10_000,
        lines: [{ lineId: 'l1', glAccountId: 'ei_acct_rent', amount: 10_000 }],
      })
    ).toThrow(/implied 1.0 rate/)
  })

  it('drops a zero line rather than demanding an account for it', () => {
    const built = buildVendorCreditEntry({
      ...BASE,
      total: 10_000,
      lines: [
        { lineId: 'l1', glAccountId: 'ei_acct_rent', amount: 10_000 },
        { lineId: 'l2', glAccountId: null, amount: 0, description: 'No charge' },
      ],
    })
    expect(built.creditLines).toHaveLength(1)
  })
})
