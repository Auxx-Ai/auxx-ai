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
  settlements: [
    {
      settlementId: 'rs_1',
      creditMemoInstanceId: 'cm_1',
      creditControlGlAccountId: 'gl_ar',
      amountMinor: 20_000,
    },
  ],
}

describe('buildRefundEntry', () => {
  it('debits each memo control account and credits the endpoint for the whole movement', () => {
    const built = buildRefundEntry({
      ...BASE,
      settlements: [
        BASE.settlements[0]!,
        {
          settlementId: 'rs_2',
          creditMemoInstanceId: 'cm_2',
          creditControlGlAccountId: 'gl_credit',
          amountMinor: 5_000,
        },
      ],
    })

    expect(built.totalMinor).toBe(25_000)
    expect(
      built.entry.lines.map((line) => [line.glAccountId, line.direction, line.amount])
    ).toEqual([
      ['gl_ar', 'debit', 20_000],
      ['gl_credit', 'debit', 5_000],
      ['gl_bank', 'credit', 25_000],
    ])
    expect(built.entry.totalDebit).toBe(built.entry.totalCredit)
  })

  it('names the customer on every control leg and never on the endpoint', () => {
    const built = buildRefundEntry(BASE)

    expect(built.entry.lines[0]).toMatchObject({
      counterpartyType: 'customer',
      counterpartyId: 'ct_1',
    })
    expect(built.entry.lines[1]?.counterpartyId).toBeUndefined()
  })

  it('carries the memo and settlement as dimensions, so a slice is traceable', () => {
    expect(buildRefundEntry(BASE).entry.lines[0]?.dimensions).toEqual({
      creditMemoInstanceId: 'cm_1',
      settlementId: 'rs_1',
    })
  })

  it('carries the route dimensions on the endpoint leg only', () => {
    const built = buildRefundEntry({ ...BASE, endpointDimensions: { paymentGatewayId: 'pg_1' } })

    expect(built.entry.lines[1]?.dimensions).toEqual({ paymentGatewayId: 'pg_1' })
  })

  it('keys the entry on a HASH of the movement, inside the document-number cap', () => {
    // `refund:<cuid>` compacted to 31 characters and refused at `buildDocNumber`.
    expect(buildRefundEntry(BASE).periodKey).toBe(movementPeriodKey('refund', 'mt_1'))
    expect(buildRefundEntry(BASE).entry.periodKey).toBe(movementPeriodKey('refund', 'mt_1'))
    expect(
      buildDocNumber({ postingType: 'refund', periodKey: buildRefundEntry(BASE).periodKey })
    ).toHaveLength(18)
  })

  it('sources every line on the movement', () => {
    for (const line of buildRefundEntry(BASE).entry.lines)
      expect(line).toMatchObject({ sourceType: 'money_transaction', sourceId: 'mt_1' })
  })

  it('refuses a blank movement, a missing endpoint and an empty partition', () => {
    expect(() => buildRefundEntry({ ...BASE, moneyTransactionId: '  ' })).toThrowError(AuxxError)
    expect(() => buildRefundEntry({ ...BASE, endpointGlAccountId: ' ' })).toThrowError(
      /the account the money left by/
    )
    expect(() => buildRefundEntry({ ...BASE, settlements: [] })).toThrowError(
      /at least one settlement slice/
    )
  })

  it('refuses a slice that is not a positive whole number of minor units', () => {
    for (const amountMinor of [0, -1, 1.5, Number.NaN]) {
      expect(() =>
        buildRefundEntry({
          ...BASE,
          settlements: [{ ...BASE.settlements[0]!, amountMinor }],
        })
      ).toThrowError(/positive whole number/)
    }
  })
})
