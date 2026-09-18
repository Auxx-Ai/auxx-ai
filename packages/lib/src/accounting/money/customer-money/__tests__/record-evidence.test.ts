// packages/lib/src/accounting/money/customer-money/__tests__/record-evidence.test.ts
import { describe, expect, it } from 'vitest'
import {
  confirmedCustomerMovement,
  customerMoneyObservationSchema,
  orderPaymentEvidenceSchema,
} from '../contracts'
import { shouldPromoteOrderObservation } from '../record-evidence'
import { readStoredCustomerMoneyObservation } from '../source-observation-adapter'

const legacy = {
  id: '51',
  kind: 'CAPTURE',
  status: 'SUCCESS',
  amount: '100.00',
  currency: 'USD',
  processedAt: '2026-09-01T00:00:00Z',
  gateway: 'another-gateway',
  settlementCurrency: 'USD',
  parentTransactionId: null,
  creditMemoExternalId: null,
  paymentId: null,
  test: false,
}
const current = {
  ...legacy,
  version: 2 as const,
  kind: 'receipt' as const,
  status: 'confirmed' as const,
  raw: legacy,
}
describe('shared stored order payment evidence', () => {
  it('uses the same receipt semantics for any source adapter', () => {
    for (const providerKey of ['another-source', 'shopify']) {
      const envelope = orderPaymentEvidenceSchema.parse({
        version: 2,
        sourceAccount: { providerKey, externalAccountId: 'merchant-A', environment: 'live' },
        orderExternalId: 'O1',
        sourceUpdatedAt: null,
        complete: true,
        transactions: [current],
      })
      expect(
        confirmedCustomerMovement(customerMoneyObservationSchema.parse(envelope.transactions[0]))
      ).toMatchObject({ purpose: 'customer_receipt', amountMinor: 10000n, currency: 'USD' })
    }
  })
  it('retains numeric canonical identities supplied by the source app', () => {
    expect(readStoredCustomerMoneyObservation(legacy).success).toBe(false)
    const parsed = readStoredCustomerMoneyObservation(current)
    expect(parsed.success).toBe(true)
    if (parsed.success)
      expect(parsed.data).toMatchObject({
        id: '51',
        kind: 'receipt',
        status: 'confirmed',
        raw: legacy,
      })
  })
  it('preserves unresolved explicit refund references', () => {
    expect(
      customerMoneyObservationSchema.parse({
        ...current,
        kind: 'refund',
        parentTransactionId: '51',
        creditMemoInstanceId: 'credit-record',
      })
    ).toMatchObject({
      kind: 'refund',
      creditMemoInstanceId: 'credit-record',
      parentTransactionId: '51',
    })
  })
  it('A then B then replay A cannot replace B', () => {
    const a = { payload: current, sourceUpdatedAt: '2026-09-01T00:00:00Z' }
    const b = { payload: { ...current, amount: '110.00' }, sourceUpdatedAt: '2026-09-02T00:00:00Z' }
    expect(shouldPromoteOrderObservation(a, b)).toBe(true)
    expect(shouldPromoteOrderObservation(b, a)).toBe(false)
  })
  it('does not weaken the current source revision for identical old content', () => {
    expect(
      shouldPromoteOrderObservation(
        { payload: current, sourceUpdatedAt: '2026-09-02T00:00:00Z' },
        { payload: current, sourceUpdatedAt: '2026-09-01T00:00:00Z' }
      )
    ).toBe(false)
  })
  it('does not use arrival order for conflicting imports without source versions', () => {
    expect(
      shouldPromoteOrderObservation(
        { payload: current, sourceUpdatedAt: null },
        { payload: { ...current, amount: '111.00' }, sourceUpdatedAt: null }
      )
    ).toBe(false)
  })
  it('allows raw source metadata to change without changing financial facts', () => {
    expect(
      shouldPromoteOrderObservation(
        { payload: { ...current, raw: null } },
        { payload: current, sourceUpdatedAt: '2026-09-02T00:00:00Z' }
      )
    ).toBe(true)
  })
  it('compares source revision instants across timezone offsets', () => {
    expect(
      shouldPromoteOrderObservation(
        { payload: current, sourceUpdatedAt: '2026-09-02T01:00:00+02:00' },
        { payload: { ...current, amount: '111.00' }, sourceUpdatedAt: '2026-09-02T00:00:00Z' }
      )
    ).toBe(true)
  })
})
