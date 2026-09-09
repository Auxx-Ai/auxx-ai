// packages/lib/src/money/payments/refund-transaction.test.ts
//
// The Stripe refund rail after plans/accounting/tasks/10-credit-memos.md §5.3: a partial
// `amount`, and a `creditMemoInstanceId` that changes what the refund means.
//
// The allocation copy is the property under test. A refund's allocations are what
// `computeAmountPaid` nets off each invoice once it succeeds, so a partial refund must copy
// only its amount, a second partial must not copy what the first already did, and a refund
// that settles a CREDIT MEMO must copy nothing at all: the memo already took its amount off
// the customer's debt, and the invoice the charge paid stays exactly as paid as it was.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  charge: {} as Record<string, unknown>,
  /** Refunds already pending/processing/succeeded against the charge. */
  existingRefunds: [] as Array<Record<string, unknown>>,
  /** `PaymentAllocation.findMany` answers, in call order: the charge's, then prior refunds'. */
  allocationAnswers: [] as Array<Array<Record<string, unknown>>>,
  inserts: [] as Array<[string, unknown]>,
  stripeRefunds: [] as Array<Record<string, unknown>>,
  memo: {} as Record<string, unknown>,
  memoChecks: [] as Array<Record<string, unknown>>,
  synced: [] as string[],
}))

vi.mock('@auxx/database', () => {
  const tableName = (table: unknown) => (table as { __table: string }).__table
  const chain: Record<string, unknown> = {}
  for (const key of ['set', 'where']) chain[key] = () => chain
  // biome-ignore lint/suspicious/noThenProperty: chainable drizzle query-builder stub
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve([]).then(resolve)
  return {
    database: {
      query: {
        PaymentTransaction: {
          findFirst: async () => h.charge,
          findMany: async () => h.existingRefunds,
        },
        PaymentAllocation: { findMany: async () => h.allocationAnswers.shift() ?? [] },
      },
      insert: (table: unknown) => ({
        values: (values: unknown) => {
          h.inserts.push([tableName(table), values])
          const row = { id: 'refund-row', ...(Array.isArray(values) ? {} : (values as object)) }
          const promise = Promise.resolve([row]) as Promise<unknown[]> & {
            returning: () => Promise<unknown[]>
          }
          promise.returning = () => Promise.resolve([row])
          return promise
        },
      }),
      update: () => chain,
    },
    schema: new Proxy(
      {},
      {
        get: (_t, table) =>
          new Proxy(
            { __table: String(table) },
            {
              get: (target, col) =>
                col === '__table' ? target.__table : `${String(table)}.${String(col)}`,
            }
          ),
      }
    ),
  }
})
vi.mock('../../cache', () => ({ getOrgCache: () => ({ get: async () => 'system-user' }) }))
vi.mock('../../resources/crud', () => ({ UnifiedCrudHandler: class {} }))
vi.mock('../../field-values/relationship-field', () => ({ extractRelationshipRecordIds: () => [] }))
vi.mock('../../settings/settings-service', () => ({ getOrganizationSetting: async () => 'USD' }))
vi.mock('../public-token', () => ({
  buildPayUrl: () => '',
  ensureInvoicePublicToken: async () => '',
}))
vi.mock('../quote-public-token', () => ({
  buildQuoteViewUrl: () => '',
  ensureQuotePublicToken: async () => '',
}))
vi.mock('./account-state', () => ({
  getPaymentAccount: async () => ({ id: 'acct-row', stripeAccountId: 'acct_123' }),
  syncAccountState: async () => {},
  upsertPaymentAccount: async () => {},
}))
vi.mock('./connect-client', () => ({
  getStripeConnectClient: () => ({
    refunds: {
      create: async (params: Record<string, unknown>) => {
        h.stripeRefunds.push(params)
        return { id: 're_1' }
      },
    },
  }),
}))
vi.mock('./deposit', () => ({ resolveQuoteDeposit: async () => ({ depositAmount: 0 }) }))
vi.mock('./fees', () => ({ resolveApplicationFee: () => 0 }))
vi.mock('./receipt-email', () => ({ sendPaymentReceipt: async () => {} }))
vi.mock('./ledger', () => ({
  readCreditMemoForRefund: async (params: Record<string, unknown>) => {
    h.memoChecks.push(params)
    return h.memo
  },
  syncInvoicePaymentState: async (params: { invoiceInstanceId: string }) => {
    h.synced.push(params.invoiceInstanceId)
  },
  syncTransaction: async () => {},
}))

const { refundTransaction } = await import('./stripe-rail')
const { BadRequestError } = await import('../../errors')

const ORG = 'org-1'
const USER = 'user-1'
const input = { organizationId: ORG, userId: USER, transactionId: 'charge-1' }

function allocationInserts(): Array<{ invoiceInstanceId: string; amount: number }> {
  return h.inserts
    .filter(([table]) => table === 'PaymentAllocation')
    .flatMap(([, values]) => values as Array<{ invoiceInstanceId: string; amount: number }>)
    .map(({ invoiceInstanceId, amount }) => ({ invoiceInstanceId, amount }))
}

function refundRow(): Record<string, unknown> {
  return h.inserts.find(([table]) => table === 'PaymentTransaction')![1] as Record<string, unknown>
}

beforeEach(() => {
  h.charge = {
    id: 'charge-1',
    organizationId: ORG,
    provider: 'stripe',
    kind: 'charge',
    status: 'succeeded',
    amount: 500,
    currency: 'USD',
    stripeChargeId: 'ch_1',
    paymentAccountId: 'acct-row',
    invoiceInstanceId: 'inv-1',
    contactInstanceId: 'contact-1',
    quoteInstanceId: null,
    workOrderInstanceId: null,
  }
  h.existingRefunds = []
  h.allocationAnswers = [[{ invoiceInstanceId: 'inv-1', amount: 500 }]]
  h.inserts = []
  h.stripeRefunds = []
  h.memo = {
    status: 'issued',
    balance: 120,
    contactInstanceId: 'contact-1',
    invoiceInstanceId: 'inv-1',
  }
  h.memoChecks = []
  h.synced = []
})

describe('refundTransaction - the full refund, unchanged', () => {
  it('refunds everything and copies the allocations exactly when no amount is given', async () => {
    await refundTransaction(input)
    expect(refundRow()).toMatchObject({ kind: 'refund', status: 'pending', amount: 500 })
    expect(allocationInserts()).toEqual([{ invoiceInstanceId: 'inv-1', amount: 500 }])
    expect(h.stripeRefunds[0]).toMatchObject({ charge: 'ch_1', amount: 500 })
    expect(h.synced).toEqual(['inv-1'])
  })

  it('refuses a charge already refunded in full', async () => {
    h.existingRefunds = [{ id: 'refund-0', amount: 500 }]
    await expect(refundTransaction(input)).rejects.toThrow(/already been refunded in full/)
    expect(h.inserts).toEqual([])
  })
})

describe('refundTransaction - a partial amount', () => {
  it('copies only the refunded slice of the allocation', async () => {
    await refundTransaction({ ...input, amount: 120 })
    expect(refundRow()).toMatchObject({ amount: 120 })
    expect(allocationInserts()).toEqual([{ invoiceInstanceId: 'inv-1', amount: 120 }])
    expect(h.stripeRefunds[0]).toMatchObject({ charge: 'ch_1', amount: 120 })
  })

  it('fills across two invoices in allocation order', async () => {
    h.allocationAnswers = [
      [
        { invoiceInstanceId: 'inv-1', amount: 300 },
        { invoiceInstanceId: 'inv-2', amount: 200 },
      ],
    ]
    await refundTransaction({ ...input, amount: 350 })
    expect(allocationInserts()).toEqual([
      { invoiceInstanceId: 'inv-1', amount: 300 },
      { invoiceInstanceId: 'inv-2', amount: 50 },
    ])
    expect(h.synced).toEqual(['inv-1', 'inv-2'])
  })

  // The second refund of a charge must not net the same money off the invoice twice.
  it('nets what an earlier refund of the charge already copied', async () => {
    h.existingRefunds = [{ id: 'refund-0', amount: 120 }]
    h.allocationAnswers = [
      [{ invoiceInstanceId: 'inv-1', amount: 500 }],
      [{ invoiceInstanceId: 'inv-1', amount: 120 }],
    ]
    await refundTransaction({ ...input, amount: 380 })
    expect(allocationInserts()).toEqual([{ invoiceInstanceId: 'inv-1', amount: 380 }])
  })

  it('caps the amount at what is still refundable', async () => {
    h.existingRefunds = [{ id: 'refund-0', amount: 120 }]
    await expect(refundTransaction({ ...input, amount: 381 })).rejects.toThrow(/between 1 and 380/)
    expect(h.inserts).toEqual([])
  })

  it('defaults to what is still refundable when a prior partial exists', async () => {
    h.existingRefunds = [{ id: 'refund-0', amount: 120 }]
    h.allocationAnswers = [
      [{ invoiceInstanceId: 'inv-1', amount: 500 }],
      [{ invoiceInstanceId: 'inv-1', amount: 120 }],
    ]
    await refundTransaction(input)
    expect(refundRow()).toMatchObject({ amount: 380 })
    expect(h.stripeRefunds[0]).toMatchObject({ amount: 380 })
  })

  it.each([0, -1, 12.5])('refuses an amount of %s', async (amount) => {
    await expect(refundTransaction({ ...input, amount })).rejects.toBeInstanceOf(BadRequestError)
    expect(h.inserts).toEqual([])
  })

  // A failed refund gave nothing back; its amount is refundable again.
  it('does not count a failed refund against what is left', async () => {
    h.existingRefunds = []
    await refundTransaction({ ...input, amount: 500 })
    expect(refundRow()).toMatchObject({ amount: 500 })
  })
})

describe('refundTransaction - settling a credit memo', () => {
  it('stamps the memo on the refund row and copies no allocation', async () => {
    await refundTransaction({ ...input, amount: 120, creditMemoInstanceId: 'memo-1' })
    expect(refundRow()).toMatchObject({
      amount: 120,
      creditMemoInstanceId: 'memo-1',
      refundedTransactionId: 'charge-1',
      invoiceInstanceId: 'inv-1',
      contactInstanceId: 'contact-1',
    })
    expect(allocationInserts()).toEqual([])
    expect(h.synced).toEqual([])
    expect(h.stripeRefunds[0]).toMatchObject({ charge: 'ch_1', amount: 120 })
  })

  it('validates the amount against the memo through the shared read', async () => {
    await refundTransaction({ ...input, amount: 120, creditMemoInstanceId: 'memo-1' })
    expect(h.memoChecks).toEqual([
      { organizationId: ORG, userId: USER, creditMemoInstanceId: 'memo-1', amount: 120 },
    ])
  })

  it('refuses a memo raised on a different contact than the charge', async () => {
    h.memo.contactInstanceId = 'contact-2'
    await expect(
      refundTransaction({ ...input, amount: 120, creditMemoInstanceId: 'memo-1' })
    ).rejects.toThrow(/different contact/)
    expect(h.inserts).toEqual([])
  })

  it('stamps no memo on a plain refund', async () => {
    await refundTransaction({ ...input, amount: 120 })
    expect(refundRow()).toMatchObject({ creditMemoInstanceId: null })
  })
})
