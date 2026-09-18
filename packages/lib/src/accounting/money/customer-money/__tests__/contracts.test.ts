// packages/lib/src/accounting/money/customer-money/__tests__/contracts.test.ts
import { describe, expect, it } from 'vitest'
import {
  confirmedCustomerMovement,
  customerMoneyObservationSchema,
  exactSourceMoney,
} from '../contracts'

const observation = {
  version: 2 as const,
  id: 'capture1',
  kind: 'receipt' as const,
  status: 'confirmed' as const,
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
    expect(confirmedCustomerMovement(observation).purpose).toBe('customer_receipt')
    for (const patch of [
      { kind: 'authorization' as const },
      { status: 'pending' as const },
      { status: 'failed' as const },
    ])
      expect(() => confirmedCustomerMovement({ ...observation, ...patch })).toThrow()
  })
  it('preserves refund as a separate positive movement', () => {
    const result = confirmedCustomerMovement({
      ...observation,
      id: 'refund1',
      kind: 'refund',
      amount: '2.00',
      parentTransactionId: 'capture1',
    })
    expect(result.purpose).toBe('customer_refund')
    expect(result.amountMinor).toBe(200n)
  })
  it('never accepts order-total summaries as actual transaction evidence', () =>
    expect(
      customerMoneyObservationSchema.safeParse({ amount: '10', currency: 'USD' }).success
    ).toBe(false))
  it('refuses a timestamp without a timezone', () =>
    expect(() =>
      confirmedCustomerMovement({ ...observation, processedAt: '2026-09-01T10:00:00' })
    ).toThrow())
})
