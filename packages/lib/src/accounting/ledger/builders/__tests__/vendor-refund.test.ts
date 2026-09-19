// packages/lib/src/accounting/ledger/builders/__tests__/vendor-refund.test.ts
//
// The customer refund's entry with the sides flipped: money ARRIVES in the
// endpoint and the vendor credit's control account is relieved. What is worth
// pinning is that the control legs carry `counterpartyType: 'vendor'` (the
// export refuses an A/P line without one) and the endpoint leg carries none.

import { describe, expect, it } from 'vitest'
import { REFUND_POSTING_TYPE } from '../refund'
import { buildVendorRefundEntry } from '../vendor-refund'

const BASE = {
  moneyTransactionId: 'mt_1',
  txnDate: '2026-09-18',
  endpointGlAccountId: 'ei_acct_bank',
  vendorInstanceId: 'ei_company_supplier',
}

describe('buildVendorRefundEntry', () => {
  it('debits the endpoint once and credits each slice', () => {
    const built = buildVendorRefundEntry({
      ...BASE,
      settlements: [
        {
          settlementId: 's1',
          vendorCreditInstanceId: 'ei_credit_1',
          creditControlGlAccountId: 'ei_acct_ap',
          amountMinor: 12_000,
        },
        {
          settlementId: 's2',
          vendorCreditInstanceId: 'ei_credit_2',
          creditControlGlAccountId: 'ei_acct_ap',
          amountMinor: 8_000,
        },
      ],
    })

    expect(built.periodKey).toBe('refund:mt_1')
    expect(built.totalMinor).toBe(20_000)
    expect(built.entry.postingType).toBe(REFUND_POSTING_TYPE)

    const [endpoint, ...controls] = built.entry.lines
    expect(endpoint).toMatchObject({
      glAccountId: 'ei_acct_bank',
      direction: 'debit',
      amount: 20_000,
    })
    expect(endpoint?.counterpartyId).toBeUndefined()
    expect(controls.map((line) => [line.direction, line.amount, line.counterpartyType])).toEqual([
      ['credit', 12_000, 'vendor'],
      ['credit', 8_000, 'vendor'],
    ])
    expect(controls[0]?.dimensions).toMatchObject({
      vendorCreditInstanceId: 'ei_credit_1',
      settlementId: 's1',
    })
  })

  it('carries the endpoint dimensions onto the endpoint leg only', () => {
    const built = buildVendorRefundEntry({
      ...BASE,
      endpointDimensions: { refundMethod: 'bank', paymentGatewayId: 'pg_1' },
      settlements: [
        {
          settlementId: 's1',
          vendorCreditInstanceId: 'ei_credit_1',
          creditControlGlAccountId: 'ei_acct_ap',
          amountMinor: 5_000,
        },
      ],
    })
    expect(built.entry.lines[0]?.dimensions).toMatchObject({ paymentGatewayId: 'pg_1' })
    expect(built.entry.lines[1]?.dimensions).not.toHaveProperty('paymentGatewayId')
  })

  it('refuses an empty settlement list', () => {
    expect(() => buildVendorRefundEntry({ ...BASE, settlements: [] })).toThrow(
      /at least one settlement slice/
    )
  })

  it('refuses a slice that is not a positive whole number of minor units', () => {
    expect(() =>
      buildVendorRefundEntry({
        ...BASE,
        settlements: [
          {
            settlementId: 's1',
            vendorCreditInstanceId: 'ei_credit_1',
            creditControlGlAccountId: 'ei_acct_ap',
            amountMinor: -1,
          },
        ],
      })
    ).toThrow(/positive whole number/)
  })

  it('refuses when no endpoint was resolved', () => {
    expect(() =>
      buildVendorRefundEntry({
        ...BASE,
        endpointGlAccountId: '  ',
        settlements: [
          {
            settlementId: 's1',
            vendorCreditInstanceId: 'ei_credit_1',
            creditControlGlAccountId: 'ei_acct_ap',
            amountMinor: 5_000,
          },
        ],
      })
    ).toThrow(/the account the money arrived in/)
  })
})
