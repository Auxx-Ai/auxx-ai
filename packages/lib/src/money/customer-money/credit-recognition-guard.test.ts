// packages/lib/src/money/customer-money/credit-recognition-guard.test.ts

import { describe, expect, it, vi } from 'vitest'

vi.mock('./reads', () => ({
  readOrderMoneyCoverage: vi.fn(async () => ({
    sourceAvailable: false,
    sourceStoreIds: [],
    complete: true,
    fetched: 0,
    accepted: 0,
    pending: 0,
  })),
}))

vi.mock('./recognition-facts', () => ({
  readOrderRecognitionFactsInTx: vi.fn(async () => ({
    subtotal: 1000n,
    shipping: 0n,
    tax: 0n,
    taxComponents: [],
  })),
}))

vi.mock('../fulfillments/reads', () => ({
  loadFulfillmentFieldContext: vi.fn(async () => null),
}))

function databaseWithAcceptedCredit(accepted = true) {
  const selectBuilder = {
    from() {
      return this
    },
    innerJoin() {
      return this
    },
    where() {
      return this
    },
    limit: async () => (accepted ? [{ id: 'credit-effect-1' }] : []),
  }
  const empty = { findMany: vi.fn(async () => []) }
  return {
    select: vi.fn(() => selectBuilder),
    query: {
      FinancialSourceAcceptance: empty,
      MoneyApplication: empty,
    },
  }
}

describe('order recognition credit guard', () => {
  it.each([
    true,
    false,
  ])('adds the credit blocker only when accepted credit exists: %s', async (accepted) => {
    const { readOrderRecognitionSource } = await import('./recognition-source')
    const source = await readOrderRecognitionSource(databaseWithAcceptedCredit(accepted) as never, {
      organizationId: 'org-1',
      orderId: 'order-1',
      orderNetMinor: '1000',
      orderTaxMinor: '0',
      bookTimeZone: 'UTC',
    })

    expect(
      source.blockers.includes(
        'Order recognition must include its accepted credit components before further posting'
      )
    ).toBe(accepted)
  })
})
