// packages/lib/src/postings/__tests__/build-payment-entry.test.ts
//
// Two things here are worth more than the arithmetic:
//
//  1. **A refund is the DIRECTION, not a negative amount.** `GlPostingLine`
//     stores a positive amount with `direction` as the only carrier of sign, so
//     the refund test asserts the mirrored pair rather than a sign flip.
//  2. **The period key is a hash, and the reason is a merge, not a length.** A
//     counted `PMT-0001` sequence lets two concurrent payments mint the same
//     key, and the claim's unique index would converge the loser to
//     `already_posted` - a SUCCESS - silently merging two payments into one
//     entry. The determinism test is what pins that decision.

import { describe, expect, it } from 'vitest'
import { UnprocessableEntityError } from '../../errors'
import { ACCOUNT_ROLES } from '../build-entry'
import {
  buildPaymentEntry,
  PAYMENT_ROUTE_ROLE,
  PAYMENT_SOURCE_TYPE,
  paymentPeriodKey,
} from '../build-payment-entry'
import { DOC_NUMBER_MAX_LENGTH } from '../doc-number'
import type { PostingType } from '../types'

// The `payment` posting type does not exist yet - `types.ts` is coordinator-held
// and the union has two copies that move in one change. The builder takes the
// type as a parameter for exactly this reason; the tests use an existing member
// so nothing here depends on a union that has not landed.
const POSTING_TYPE = 'manual_journal' as PostingType

const TRANSACTION = {
  id: 'pt_ab12cd34ef56gh78ij90kl',
  kind: 'charge' as const,
  amountMinor: 55_500,
  method: 'check',
  currency: 'USD',
  receivedAt: '2026-09-04',
  reference: 'CHQ-8811',
}

const BASE = {
  postingType: POSTING_TYPE,
  transaction: TRANSACTION,
  route: 'undeposited_funds' as const,
  periodKey: 'PMT-ABC1234',
  ledgerCurrency: 'USD',
}

function line(entry: ReturnType<typeof buildPaymentEntry>['entry'], role: string) {
  return entry.lines.find((row) => row.accountRole === role)
}

describe('the route table', () => {
  it('maps all three routes and sends clearing to the one clearing role', () => {
    expect(Object.keys(PAYMENT_ROUTE_ROLE).sort()).toEqual([
      'cash',
      'clearing',
      'undeposited_funds',
    ])
    expect(PAYMENT_ROUTE_ROLE.undeposited_funds).toBe(ACCOUNT_ROLES.UNDEPOSITED_FUNDS)
    expect(PAYMENT_ROUTE_ROLE.cash).toBe(ACCOUNT_ROLES.CASH)
    expect(PAYMENT_ROUTE_ROLE.clearing).toBe(ACCOUNT_ROLES.CLEARING_SHOPIFY)
  })

  it.each([
    'undeposited_funds',
    'cash',
    'clearing',
  ] as const)('debits the %s account and credits A/R for a charge', (route) => {
    const built = buildPaymentEntry({ ...BASE, route })
    expect(built.routeRole).toBe(PAYMENT_ROUTE_ROLE[route])
    expect(line(built.entry, PAYMENT_ROUTE_ROLE[route])?.direction).toBe('debit')
    expect(line(built.entry, ACCOUNT_ROLES.ACCOUNTS_RECEIVABLE)?.direction).toBe('credit')
    expect(built.entry.totalDebit).toBe(55_500)
    expect(built.entry.totalDebit).toBe(built.entry.totalCredit)
  })
})

describe('a refund', () => {
  it('mirrors the pair rather than negating the amount', () => {
    const charge = buildPaymentEntry(BASE)
    const refund = buildPaymentEntry({
      ...BASE,
      transaction: { ...TRANSACTION, kind: 'refund' },
    })

    expect(line(charge.entry, ACCOUNT_ROLES.UNDEPOSITED_FUNDS)?.direction).toBe('debit')
    expect(line(refund.entry, ACCOUNT_ROLES.UNDEPOSITED_FUNDS)?.direction).toBe('credit')
    expect(line(charge.entry, ACCOUNT_ROLES.ACCOUNTS_RECEIVABLE)?.direction).toBe('credit')
    expect(line(refund.entry, ACCOUNT_ROLES.ACCOUNTS_RECEIVABLE)?.direction).toBe('debit')
    for (const row of refund.entry.lines) expect(row.amount).toBeGreaterThan(0)
  })
})

describe('refusals', () => {
  it('refuses a currency other than the ledger currency, naming it', () => {
    expect(() =>
      buildPaymentEntry({ ...BASE, transaction: { ...TRANSACTION, currency: 'EUR' } })
    ).toThrowError(/EUR/)
  })

  it('refuses a negative, zero or fractional amount', () => {
    for (const amountMinor of [-1, 0, 12.5]) {
      expect(() =>
        buildPaymentEntry({ ...BASE, transaction: { ...TRANSACTION, amountMinor } })
      ).toThrowError(UnprocessableEntityError)
    }
  })
})

describe('the minted period key', () => {
  it('sources every line on the LEDGER ROW, never on the payment entity mirror', () => {
    // Refund rows get no `payment` mirror at all, so a source on the entity
    // would silently miss every refund.
    const built = buildPaymentEntry(BASE)
    for (const row of built.entry.lines) {
      expect(row.sourceType).toBe(PAYMENT_SOURCE_TYPE)
      expect(row.sourceId).toBe(TRANSACTION.id)
    }
  })

  it('is deterministic in the transaction id, so a re-post converges', () => {
    expect(paymentPeriodKey(TRANSACTION.id)).toBe(paymentPeriodKey(TRANSACTION.id))
  })

  it('differs between transactions', () => {
    const keys = new Set(
      ['pt_a', 'pt_b', 'pt_c', 'pt_aa', 'pt_ab', TRANSACTION.id].map(paymentPeriodKey)
    )
    expect(keys.size).toBe(6)
  })

  it('fits the document-number cap with room for a reversal suffix', () => {
    const key = paymentPeriodKey(TRANSACTION.id)
    expect(`AUXX-PMT-${key.replace(/-/g, '')}-R9`.length).toBeLessThanOrEqual(DOC_NUMBER_MAX_LENGTH)
  })

  it('refuses a blank transaction id', () => {
    expect(() => paymentPeriodKey('  ')).toThrowError(/transaction id/)
  })
})
