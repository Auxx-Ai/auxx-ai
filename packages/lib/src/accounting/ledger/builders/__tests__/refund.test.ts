// packages/lib/src/accounting/ledger/builders/__tests__/refund.test.ts

import { describe, expect, it } from 'vitest'
import { AuxxError } from '../../../../errors'
import { buildDocNumber } from '../doc-number'
import { movementPeriodKey } from '../movement-key'
import { buildRefundEntry } from '../refund'

const BASE = {
  moneyTransactionId: 'mt_1',
  txnDate: '2026-09-04',
  customerInstanceId: 'ct_1',
  endpointGlAccountId: 'gl_bank',
  endpointRole: 'bank' as const,
  amountMinor: 20_000,
}

describe('buildRefundEntry', () => {
  it('debits the accounts_receivable role and credits the endpoint for the movement', () => {
    const built = buildRefundEntry(BASE)

    expect(built.totalMinor).toBe(20_000)
    expect(
      built.entry.lines.map((line) => [
        line.glAccountId ?? line.accountRole,
        line.direction,
        line.amount,
      ])
    ).toEqual([
      ['accounts_receivable', 'debit', 20_000],
      ['gl_bank', 'credit', 20_000],
    ])
    // 101 E8: the endpoint carries its role as a snapshot beside the id.
    expect(built.entry.lines[1]).toMatchObject({ glAccountId: 'gl_bank', accountRole: 'bank' })
    expect(built.entry.totalDebit).toBe(built.entry.totalCredit)
  })

  // 91 D8: a chargeback carries its dispute fee as its own expense, out of the same endpoint.
  it('debits a dispute fee to payment_processing_fees and credits the endpoint the sum', () => {
    const built = buildRefundEntry({ ...BASE, feeMinor: 1_500 })

    expect(built.totalMinor).toBe(21_500)
    expect(
      built.entry.lines.map((line) => [
        line.glAccountId ?? line.accountRole,
        line.direction,
        line.amount,
      ])
    ).toEqual([
      ['accounts_receivable', 'debit', 20_000],
      ['payment_processing_fees', 'debit', 1_500],
      ['gl_bank', 'credit', 21_500],
    ])
    expect(built.entry.lines[1]?.counterpartyId).toBeUndefined()
  })

  it('posts no fee leg at zero and refuses a negative or fractional fee', () => {
    expect(buildRefundEntry({ ...BASE, feeMinor: 0 }).entry.lines).toHaveLength(2)
    expect(() => buildRefundEntry({ ...BASE, feeMinor: -1 })).toThrow(AuxxError)
    expect(() => buildRefundEntry({ ...BASE, feeMinor: 1.5 })).toThrow(AuxxError)
  })

  it('names the customer on the receivable leg and never on the endpoint', () => {
    const built = buildRefundEntry(BASE)

    expect(built.entry.lines[0]).toMatchObject({
      counterpartyType: 'customer',
      counterpartyId: 'ct_1',
    })
    expect(built.entry.lines[1]?.counterpartyId).toBeUndefined()
  })

  it('carries the settlement as a dimension only when given one', () => {
    expect(buildRefundEntry(BASE).entry.lines[0]?.dimensions).toBeUndefined()
    expect(buildRefundEntry({ ...BASE, settlementId: 'rs_1' }).entry.lines[0]?.dimensions).toEqual({
      settlementId: 'rs_1',
    })
  })

  it('carries the route dimensions on the endpoint leg only', () => {
    const built = buildRefundEntry({ ...BASE, endpointDimensions: { paymentGatewayId: 'pg_1' } })

    expect(built.entry.lines[1]?.dimensions).toEqual({ paymentGatewayId: 'pg_1' })
  })

  it('keys the entry on a HASH of the movement, inside the document-number cap', () => {
    // `refund:<cuid>` is over the cap on its own and would be refused at `buildDocNumber`.
    expect(buildRefundEntry(BASE).periodKey).toBe(movementPeriodKey('refund', 'mt_1'))
    expect(buildRefundEntry(BASE).entry.periodKey).toBe(movementPeriodKey('refund', 'mt_1'))
    expect(
      buildDocNumber({ postingType: 'refund', periodKey: buildRefundEntry(BASE).periodKey })
    ).toMatch(/^RFD-[0-9A-Z]{6}$/)
  })

  it('sources every line on the movement', () => {
    for (const line of buildRefundEntry(BASE).entry.lines)
      expect(line).toMatchObject({ sourceType: 'money_transaction', sourceId: 'mt_1' })
  })

  it('refuses a blank movement and a missing endpoint', () => {
    expect(() => buildRefundEntry({ ...BASE, moneyTransactionId: '  ' })).toThrowError(AuxxError)
    expect(() => buildRefundEntry({ ...BASE, endpointGlAccountId: ' ' })).toThrowError(
      /the account the money left by/
    )
  })

  it('refuses an amount that is not a positive whole number of minor units', () => {
    for (const amountMinor of [0, -1, 1.5, Number.NaN]) {
      expect(() => buildRefundEntry({ ...BASE, amountMinor })).toThrowError(/positive whole number/)
    }
  })

  it('memos every line with the movement id ahead of the leg label', () => {
    const built = buildRefundEntry(BASE)
    expect(built.entry.lines.map((row) => row.memo)).toEqual([
      'txn mt_1 · Customer refund',
      'txn mt_1 · Customer refund',
    ])
  })
})
