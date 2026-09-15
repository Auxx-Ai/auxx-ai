// packages/lib/src/money/customer-money/__tests__/contracts.test.ts
import { describe, expect, it } from 'vitest'
import {
  confirmedShopifyMovement,
  exactSourceMoney,
  shopifyMoneyObservationSchema,
} from '../contracts'

const observation = {
  id: 'capture1',
  kind: 'CAPTURE',
  status: 'SUCCESS',
  amount: '10.01',
  currency: 'USD',
  processedAt: '2026-09-01T01:30:00Z',
  gateway: 'stripe',
  settlementCurrency: 'USD',
  parentTransactionId: null,
  creditMemoExternalId: null,
  paymentId: null,
  test: false,
}
describe('exact customer money source contracts', () => {
  it('keeps exact bigint precision beyond JavaScript safe integers', () =>
    expect(exactSourceMoney('90071992547409.93', 'USD').amountMinor).toBe(9007199254740993n))
  it('preserves zero and three-decimal currency exponents', () => {
    expect(exactSourceMoney('123', 'JPY').amountMinor).toBe(123n)
    expect(exactSourceMoney('1.234', 'KWD').amountMinor).toBe(1234n)
  })
  it.each([
    '1.001',
    'NaN',
    '1e3',
    '-1.00',
    '0',
    '92233720368547758.08',
  ])('rejects invalid USD movement %s', (amount) =>
    expect(() => exactSourceMoney(amount, 'USD')).toThrow())
  it('refuses invented currency codes', () => expect(() => exactSourceMoney('1', 'XYZ')).toThrow())
  it('distinguishes capture from authorization and pending/failed movements', () => {
    expect(confirmedShopifyMovement(observation).purpose).toBe('customer_receipt')
    for (const patch of [{ kind: 'AUTHORIZATION' }, { status: 'PENDING' }, { status: 'FAILURE' }])
      expect(() => confirmedShopifyMovement({ ...observation, ...patch })).toThrow()
  })
  it('preserves refund as a separate positive movement', () => {
    const result = confirmedShopifyMovement({
      ...observation,
      id: 'refund1',
      kind: 'REFUND',
      amount: '2.00',
      parentTransactionId: 'capture1',
    })
    expect(result.purpose).toBe('customer_refund')
    expect(result.amountMinor).toBe(200n)
  })
  it('never accepts order-total summaries as actual transaction evidence', () =>
    expect(shopifyMoneyObservationSchema.safeParse({ amount: '10', currency: 'USD' }).success).toBe(
      false
    ))
  it('refuses a timestamp without a timezone', () =>
    expect(() =>
      confirmedShopifyMovement({ ...observation, processedAt: '2026-09-01T10:00:00' })
    ).toThrow())
})
