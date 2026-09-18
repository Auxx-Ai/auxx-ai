// packages/lib/src/sales/credit-memos/__tests__/record-refund.test.ts
//
// The manual refund rail of a credit memo, on the money model (64 §2 U2).
//
// Two properties carry this file. First, the rows: a `customer_refund`
// `MoneyTransaction` plus one `customer_credit` `MoneyRefundSettlement` naming
// the memo, and NO `MoneyApplication` - an application relieves an INVOICE's
// receivable, and this money settles the memo (10-credit-memos §8 step 3 leaves
// the invoice at its full balance). Second, the two-way endpoint: the org's
// `accounting.paymentRoute.<method>` setting decides whether the refund must
// name a bank account or must not, and both wrong answers still balance.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  memo: {} as Record<string, unknown>,
  /** Every `insert(table).values(...)`: `[tableName, values]`. */
  inserts: [] as Array<[string, Record<string, unknown>]>,
  settings: {} as Record<string, unknown>,
}))

vi.mock('../../../accounting/money/commands/run-money-command', () => ({
  runMoneyCommand: async (
    db: unknown,
    _input: unknown,
    run: (tx: unknown, commandId: string) => unknown
  ) => run(db, 'command-1'),
}))
vi.mock('../reads', async () => {
  const { BadRequestError, NotFoundError } = await import('../../../errors')
  return {
    readCreditMemoForRefund: async (params: { amount: number }) => {
      if (!h.memo.status) throw new NotFoundError('Credit memo not found')
      if (h.memo.status !== 'issued')
        throw new BadRequestError(`Cannot refund a credit memo in status '${h.memo.status}'`)
      if (params.amount > (h.memo.balance as number))
        throw new BadRequestError(
          `Refund amount exceeds the credit memo balance of ${h.memo.balance}`
        )
      return {
        status: 'issued',
        balance: h.memo.balance,
        contactInstanceId: h.memo.contact ?? null,
        invoiceInstanceId: h.memo.invoice ?? null,
      }
    },
  }
})
vi.mock('../../../cache/singletons', () => ({
  getOrgCache: () => ({ get: async () => h.settings }),
}))
vi.mock('@auxx/database', () => {
  const tableName = (table: unknown) => (table as { __table: string }).__table
  return {
    database: {
      insert: (table: unknown) => ({
        values: (values: Record<string, unknown>) => {
          h.inserts.push([tableName(table), values])
          return { returning: async () => [{ id: `${tableName(table)}-1`, ...values }] }
        },
      }),
    },
    schema: new Proxy(
      {},
      {
        get: (_t, table) => ({ __table: String(table) }),
      }
    ),
  }
})

const { recordCreditMemoRefund } = await import('../record-refund')
const { database } = await import('@auxx/database')
const { BadRequestError, NotFoundError } = await import('../../../errors')

const MEMO = 'memo-1'
const input = {
  organizationId: 'org-1',
  userId: 'user-1',
  commandKey: 'credit-refund-test',
  creditMemoInstanceId: MEMO,
  amountMinor: 120,
  date: '2026-09-08',
  method: 'check' as const,
  reference: '1042',
}
const run = (overrides: Partial<Parameters<typeof recordCreditMemoRefund>[1]> = {}) =>
  recordCreditMemoRefund(database, { ...input, ...overrides })

beforeEach(() => {
  h.memo = { status: 'issued', balance: 120, contact: 'contact-1', invoice: 'inv-1' }
  h.inserts = []
  // Shipped defaults: check -> undeposited_funds, bank -> cash, card -> clearing.
  h.settings = {}
})

describe('the rows', () => {
  it('writes the movement and one credit settlement naming the memo', async () => {
    const result = await run()
    expect(result).toEqual({
      moneyTransactionId: 'MoneyTransaction-1',
      moneySettlementId: 'MoneyRefundSettlement-1',
    })
    expect(h.inserts.map(([table]) => table)).toEqual(['MoneyTransaction', 'MoneyRefundSettlement'])
    expect(h.inserts[0]![1]).toMatchObject({
      purpose: 'customer_refund',
      amountMinor: 120n,
      currency: 'USD',
      datePrecision: 'date',
      occurredOn: '2026-09-08',
      partyInstanceId: 'contact-1',
      cashAccountInstanceId: null,
      method: 'check',
      recordedByCommandId: 'command-1',
      reference: '1042',
    })
    expect(h.inserts[1]![1]).toMatchObject({
      refundTransactionId: 'MoneyTransaction-1',
      amountMinor: 120n,
      disposition: 'customer_credit',
      customerCreditMemoInstanceId: MEMO,
      commandId: 'command-1',
    })
  })

  it('writes no MoneyApplication - a refund settles the memo, not the invoice', async () => {
    await run()
    expect(h.inserts.some(([table]) => table === 'MoneyApplication')).toBe(false)
  })
})

describe('the two-way endpoint', () => {
  it('requires a bank account when the method routes to cash', async () => {
    await expect(run({ method: 'bank' })).rejects.toThrow(/bank account this refund was paid from/)
    expect(h.inserts).toEqual([])
    await run({ method: 'bank', bankAccountInstanceId: 'bank-1' })
    expect(h.inserts[0]![1]).toMatchObject({ cashAccountInstanceId: 'bank-1' })
  })

  it('refuses a bank account when the method is held in undeposited funds', async () => {
    await expect(run({ bankAccountInstanceId: 'bank-1' })).rejects.toThrow(/undeposited funds/)
    expect(h.inserts).toEqual([])
  })

  // `clearing` exists to be drained by a payout, and a hand-recorded refund
  // produces none - so the recorder chooses, and either answer is allowed.
  it('lets a clearing-routed method take either side', async () => {
    await run({ method: 'card' })
    expect(h.inserts[0]![1]).toMatchObject({ cashAccountInstanceId: null })
    h.inserts = []
    await run({ method: 'card', bankAccountInstanceId: 'bank-1' })
    expect(h.inserts[0]![1]).toMatchObject({ cashAccountInstanceId: 'bank-1' })
  })

  it('honours an org setting that moves a method to the other side', async () => {
    h.settings = { 'accounting.paymentRoute.check': 'cash' }
    await expect(run()).rejects.toBeInstanceOf(BadRequestError)
  })
})

describe('what it refuses', () => {
  it.each([0, -5, 12.5])('refuses the amount %s', async (amountMinor) => {
    await expect(run({ amountMinor })).rejects.toBeInstanceOf(BadRequestError)
    expect(h.inserts).toEqual([])
  })

  it('refuses a date that is not a calendar day', async () => {
    await expect(run({ date: '08/09/2026' })).rejects.toBeInstanceOf(BadRequestError)
  })

  it('refuses more than the memo balance', async () => {
    h.memo.balance = 100
    await expect(run()).rejects.toThrow(/exceeds the credit memo balance/)
    expect(h.inserts).toEqual([])
  })

  it.each(['draft', 'settled', 'void'])('refuses a memo in status %s', async (status) => {
    h.memo.status = status
    await expect(run()).rejects.toThrow(`'${status}'`)
    expect(h.inserts).toEqual([])
  })

  it('refuses a memo that does not resolve', async () => {
    h.memo = {}
    await expect(run()).rejects.toBeInstanceOf(NotFoundError)
  })
})
