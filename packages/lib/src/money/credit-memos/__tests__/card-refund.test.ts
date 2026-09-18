// packages/lib/src/money/credit-memos/__tests__/card-refund.test.ts
//
// The order of operations is the whole test. A `MoneyTransaction` has no pending state, so
// Stripe is called first and `commandKey` is handed to Stripe as its own idempotency key — a
// retry after a crash between the two must return the SAME refund, not issue a second one.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  order: [] as string[],
  refundCreate: vi.fn(),
  inserts: [] as Array<{ table: string; values: Record<string, unknown> }>,
  commands: new Map<string, Record<string, string>>(),
  memo: {
    invoiceInstanceId: 'inv-1',
    contactInstanceId: 'contact-1',
  } as Record<string, unknown>,
  applications: [{ moneyTransactionId: 'mt-receipt', invoiceInstanceId: 'inv-1' }],
  receipts: [
    {
      id: 'mt-receipt',
      method: 'card',
      reference: 'pi_1',
      partyInstanceId: 'contact-1',
      amountMinor: 10_000n,
      occurredAt: new Date('2026-01-01T00:00:00Z'),
    },
  ] as Array<Record<string, unknown>>,
  settlements: [] as Array<Record<string, unknown>>,
  posted: [] as string[],
  settled: [] as string[],
}))

vi.mock('@auxx/database', () => ({
  database: {},
  schema: {
    MoneyTransaction: 'MoneyTransaction',
    MoneyApplication: 'MoneyApplication',
    MoneyRefundSettlement: 'MoneyRefundSettlement',
  },
}))
vi.mock('drizzle-orm', () => ({
  and: () => undefined,
  eq: () => undefined,
  inArray: () => undefined,
}))
vi.mock('../reads', () => ({ readCreditMemoForRefund: async () => h.memo }))
vi.mock('../settle', () => ({
  settleCreditMemo: async (_db: unknown, input: { creditMemoInstanceId: string }) => {
    h.order.push('settle')
    h.settled.push(input.creditMemoInstanceId)
    return {}
  },
}))
vi.mock('../../customer-money/refund-accounting', () => ({
  postCustomerRefundAccounting: async (_db: unknown, input: { moneyTransactionId: string }) => {
    h.order.push('post')
    h.posted.push(input.moneyTransactionId)
    return { status: 'accepted', glPostingId: 'gl-1' }
  },
}))
vi.mock('../../stripe-connect/account', () => ({
  getPaymentAccount: async () => ({ stripeAccountId: 'acct_1' }),
}))
vi.mock('../../stripe-connect/client', () => ({
  getStripeConnectClient: () => ({ refunds: { create: h.refundCreate } }),
}))
vi.mock('../../commands/run-money-command', () => ({
  runMoneyCommand: async (
    _db: unknown,
    input: { commandKey: string },
    execute: (tx: unknown, commandId: string) => Promise<Record<string, string>>
  ) => {
    h.order.push('record')
    const previous = h.commands.get(input.commandKey)
    if (previous) return previous
    const tx = {
      insert: (table: string) => ({
        values: (values: Record<string, unknown>) => {
          h.inserts.push({ table, values })
          return { returning: async () => [{ id: `${table}-1` }] }
        },
      }),
    }
    const result = await execute(tx, 'cmd-1')
    h.commands.set(input.commandKey, result)
    return result
  },
}))

const db = {
  query: {
    MoneyApplication: { findMany: async () => h.applications },
    MoneyTransaction: { findMany: async () => h.receipts },
    MoneyRefundSettlement: { findMany: async () => h.settlements },
  },
} as never

const { UnprocessableEntityError } = await import('../../../errors')
const { refundCreditMemoToCard } = await import('../card-refund')

beforeEach(() => {
  h.order.length = 0
  h.inserts.length = 0
  h.posted.length = 0
  h.settled.length = 0
  h.commands.clear()
  h.settlements = []
  h.refundCreate.mockReset()
  h.refundCreate.mockResolvedValue({ id: 're_1', created: 1_700_000_000 })
})

const input = {
  organizationId: 'org-1',
  userId: 'user-1',
  creditMemoInstanceId: 'cm-1',
  amountMinor: 4_000,
  commandKey: 'refund-key-1',
}

describe('refunding a card-paid credit memo', () => {
  it('refunds through Stripe, records the movement, posts it and settles the memo', async () => {
    const result = await refundCreditMemoToCard(db, input)

    expect(h.refundCreate).toHaveBeenCalledWith(
      { payment_intent: 'pi_1', amount: 4_000, refund_application_fee: true },
      { stripeAccount: 'acct_1', idempotencyKey: 'refund-key-1' }
    )
    expect(h.order).toEqual(['record', 'post', 'settle'])
    expect(h.inserts.find((row) => row.table === 'MoneyTransaction')!.values).toMatchObject({
      purpose: 'customer_refund',
      amountMinor: 4_000n,
      reference: 're_1',
    })
    // 🛑 A settlement, never an application: the invoice the charge paid stays as paid.
    expect(h.inserts.find((row) => row.table === 'MoneyApplication')).toBeUndefined()
    expect(h.inserts.find((row) => row.table === 'MoneyRefundSettlement')!.values).toMatchObject({
      originalTransactionId: 'mt-receipt',
      customerCreditMemoInstanceId: 'cm-1',
      disposition: 'customer_credit',
    })
    expect(result.stripeRefundId).toBe('re_1')
  })

  it('refuses when the charge has no room left', async () => {
    h.settlements = [{ originalTransactionId: 'mt-receipt', amountMinor: 9_000n }]
    await expect(refundCreditMemoToCard(db, input)).rejects.toThrow(UnprocessableEntityError)
    expect(h.refundCreate).not.toHaveBeenCalled()
  })

  it('refuses when the invoice was never paid by card', async () => {
    h.receipts = [{ ...h.receipts[0]!, method: 'check', reference: null }]
    await expect(refundCreditMemoToCard(db, input)).rejects.toThrow(UnprocessableEntityError)
    h.receipts = [
      {
        id: 'mt-receipt',
        method: 'card',
        reference: 'pi_1',
        partyInstanceId: 'contact-1',
        amountMinor: 10_000n,
        occurredAt: new Date('2026-01-01T00:00:00Z'),
      },
    ]
  })
})
