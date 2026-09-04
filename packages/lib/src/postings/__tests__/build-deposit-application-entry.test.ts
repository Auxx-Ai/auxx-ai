// packages/lib/src/postings/__tests__/build-deposit-application-entry.test.ts
//
// Two things here matter more than the two lines:
//
//  1. **The key is a hash of the ALLOCATION id, not of the transaction.** One
//     deposit split across two invoices is two allocations, so keying on the
//     transaction would let the first application swallow the second - and it
//     would swallow it as `already_posted`, a SUCCESS status, with one
//     customer's money silently missing from the books.
//  2. **The lines are sourced on the PAYMENT TRANSACTION.** That is what lets
//     `listPaymentPostings` find the reclass alongside the receipt, so deleting
//     the payment backs both out.

import { describe, expect, it } from 'vitest'
import { UnprocessableEntityError } from '../../errors'
import {
  buildDepositApplicationEntry,
  DEPOSIT_APPLICATION_SOURCE_TYPE,
  depositApplicationPeriodKey,
} from '../build-deposit-application-entry'
import { ACCOUNT_ROLES } from '../build-entry'
import { DOC_NUMBER_MAX_LENGTH, DOC_NUMBER_PREFIX } from '../doc-number'

const BASE = {
  allocationId: 'pa_ab12cd34ef56gh78ij90kl',
  transactionId: 'pt_zz98yy76xx54ww32vv10uu',
  amountMinor: 250_000,
  appliedAt: '2026-09-04',
  invoiceNumber: 'INV-0042',
}

function line(entry: ReturnType<typeof buildDepositApplicationEntry>['entry'], role: string) {
  return entry.lines.find((row) => row.accountRole === role)
}

describe('the reclass', () => {
  it('debits customer deposits and credits the receivable', () => {
    const built = buildDepositApplicationEntry(BASE)

    expect(line(built.entry, ACCOUNT_ROLES.CUSTOMER_DEPOSITS)?.direction).toBe('debit')
    expect(line(built.entry, ACCOUNT_ROLES.ACCOUNTS_RECEIVABLE)?.direction).toBe('credit')
    expect(built.entry.lines).toHaveLength(2)
    expect(built.entry.totalDebit).toBe(250_000)
    expect(built.entry.totalDebit).toBe(built.entry.totalCredit)
  })

  it('moves no cash: neither leg touches an account money passes through', () => {
    const built = buildDepositApplicationEntry(BASE)
    for (const role of [
      ACCOUNT_ROLES.CASH,
      ACCOUNT_ROLES.UNDEPOSITED_FUNDS,
      ACCOUNT_ROLES.CLEARING_SHOPIFY,
    ]) {
      expect(line(built.entry, role)).toBeUndefined()
    }
  })

  it('sources both lines on the payment transaction, never on the allocation', () => {
    const built = buildDepositApplicationEntry(BASE)
    for (const row of built.entry.lines) {
      expect(row.sourceType).toBe(DEPOSIT_APPLICATION_SOURCE_TYPE)
      expect(row.sourceId).toBe(BASE.transactionId)
    }
  })

  it("is dated the allocation's own day, not the day the money arrived", () => {
    const built = buildDepositApplicationEntry({ ...BASE, appliedAt: '2026-11-30' })
    expect(built.entry.txnDate).toBe('2026-11-30')
  })

  it('names the invoice in the memo when it has one', () => {
    expect(buildDepositApplicationEntry(BASE).entry.lines[0]?.memo).toContain('INV-0042')
    expect(
      buildDepositApplicationEntry({ ...BASE, invoiceNumber: null }).entry.lines[0]?.memo
    ).toBe('Customer deposit applied to an invoice')
  })
})

describe('refusals', () => {
  it('refuses a zero, negative or fractional amount', () => {
    for (const amountMinor of [0, -1, 12.5]) {
      expect(() => buildDepositApplicationEntry({ ...BASE, amountMinor })).toThrowError(
        UnprocessableEntityError
      )
    }
  })

  it('refuses a blank transaction id, naming what is missing', () => {
    expect(() => buildDepositApplicationEntry({ ...BASE, transactionId: '  ' })).toThrowError(
      /payment transaction/
    )
  })

  it('refuses a blank allocation id', () => {
    expect(() => depositApplicationPeriodKey('  ')).toThrowError(/allocation id/)
  })
})

describe('the minted period key', () => {
  it('is deterministic per allocation, so a re-post converges', () => {
    expect(depositApplicationPeriodKey(BASE.allocationId)).toBe(
      depositApplicationPeriodKey(BASE.allocationId)
    )
    expect(buildDepositApplicationEntry(BASE).periodKey).toBe(
      depositApplicationPeriodKey(BASE.allocationId)
    )
  })

  it('differs between the two allocations of one split deposit', () => {
    const first = depositApplicationPeriodKey('pa_first')
    const second = depositApplicationPeriodKey('pa_second')
    expect(first).not.toBe(second)
  })

  it('does not collide across ten thousand allocation ids', () => {
    const keys = new Set<string>()
    for (let index = 0; index < 10_000; index++) {
      keys.add(depositApplicationPeriodKey(`pa_clx${index.toString(36)}z9q7v`))
    }
    expect(keys.size).toBe(10_000)
  })

  it('fits the document-number cap with room for a reversal suffix', () => {
    const key = buildDepositApplicationEntry(BASE).periodKey
    expect(
      `AUXX-${DOC_NUMBER_PREFIX.deposit_application}-${key.replace(/-/g, '')}-R9`.length
    ).toBeLessThanOrEqual(DOC_NUMBER_MAX_LENGTH)
  })

  it('carries its own prefix rather than the payment prefix', () => {
    expect(DOC_NUMBER_PREFIX.deposit_application).toBe('DPA')
    expect(DOC_NUMBER_PREFIX.deposit_application).not.toBe(DOC_NUMBER_PREFIX.payment)
  })
})
