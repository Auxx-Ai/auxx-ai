// packages/lib/src/accounting/banking/review/__tests__/settlement-offers.test.ts
//
// Which rails a bank line may be coded as the settlement of (brief 27 §8.1).
//
// Pure, so no database and no doubles. The property that matters is the
// NEGATIVE one: a rail with no clearing account of its own is never offered,
// because "Settlement of X" posted to a shared default would relieve nothing X
// put there - and a debit is never a settlement of anything.

import { describe, expect, it } from 'vitest'
import type { PaymentGatewayRow } from '../../../rails/client'
import { settlementLabel, settlementOffers } from '../client'

function gateway(over: Partial<PaymentGatewayRow> & { id: string }): PaymentGatewayRow {
  return {
    recordId: `payment_gateway:${over.id}`,
    name: 'A rail',
    handles: [],
    clearingGlAccountId: 'gl_1200',
    feeGlAccountId: null,
    settlementSource: 'manual',
    feeTreatment: 'netted',
    status: 'active',
    lastSettlementAt: null,
    processorAccountId: null,
    settlementCurrency: null,
    bankAccountId: null,
    lastFeeBookedAt: null,
    createdAt: null,
    updatedAt: null,
    ...over,
  }
}

const DEPOSIT = { amountMinor: 48_231_14, bankStatus: 'posted' as const }

describe('settlementOffers', () => {
  it('offers every active rail with a clearing account, by name', () => {
    const offers = settlementOffers(
      [
        gateway({ id: 'pg_shopify', name: 'Shopify Payments', clearingGlAccountId: 'gl_1200' }),
        gateway({ id: 'pg_affirm', name: 'Affirm', clearingGlAccountId: 'gl_1210' }),
      ],
      DEPOSIT
    )
    expect(offers.map((offer) => offer.railName)).toEqual(['Affirm', 'Shopify Payments'])
    expect(offers[0]).toEqual({
      paymentGatewayId: 'pg_affirm',
      railName: 'Affirm',
      clearingGlAccountId: 'gl_1210',
      feeTreatment: 'netted',
    })
  })

  it('never offers a rail with no clearing account of its own', () => {
    const offers = settlementOffers(
      [
        gateway({ id: 'pg_blank', name: 'Blank', clearingGlAccountId: '' }),
        gateway({ id: 'pg_space', name: 'Spaces', clearingGlAccountId: '   ' }),
        gateway({ id: 'pg_ok', name: 'Routed', clearingGlAccountId: 'gl_1205' }),
      ],
      DEPOSIT
    )
    expect(offers.map((offer) => offer.paymentGatewayId)).toEqual(['pg_ok'])
  })

  it('leaves a closed rail off the offer - its history still routes, its deposits are a question', () => {
    const offers = settlementOffers(
      [gateway({ id: 'pg_authnet', name: 'Authorize.net', status: 'closed' })],
      DEPOSIT
    )
    expect(offers).toEqual([])
  })

  it('offers nothing for money OUT - a debit is never a settlement', () => {
    expect(
      settlementOffers([gateway({ id: 'pg_1' })], { amountMinor: -3_500, bankStatus: 'posted' })
    ).toEqual([])
  })

  it('offers nothing for a zero line or a void line', () => {
    expect(
      settlementOffers([gateway({ id: 'pg_1' })], { amountMinor: 0, bankStatus: 'posted' })
    ).toEqual([])
    expect(
      settlementOffers([gateway({ id: 'pg_1' })], { amountMinor: 1_000, bankStatus: 'void' })
    ).toEqual([])
  })

  it('carries the fee treatment so the panel can say whether a fee is inside the deposit', () => {
    const [offer] = settlementOffers(
      [gateway({ id: 'pg_authnet', name: 'Authorize.net', feeTreatment: 'billed' })],
      DEPOSIT
    )
    expect(offer?.feeTreatment).toBe('billed')
  })
})

describe('settlementLabel', () => {
  it('spells the offer and the rule name once', () => {
    expect(settlementLabel('Shopify Payments')).toBe('Settlement of Shopify Payments')
  })
})
