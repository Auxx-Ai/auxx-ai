// packages/lib/src/money/payments/record-manual-refund.test.ts
//
// The manual refund rail of a credit memo (plans/accounting/tasks/10-credit-memos.md §5.3).
//
// Two properties carry this file. First, the row it writes: a `manual` `refund`, already
// `succeeded`, carrying the memo, the memo's contact and the memo's invoice, and NO
// `PaymentAllocation`, because an allocation is what `computeAmountPaid` subtracts from the
// invoice and this money settles the memo, not the invoice (§8 step 3 has the invoice back
// at its full balance after an unapplied memo is refunded). Second, the posting: the whole
// amount debits `accounts_receivable`. `buildPaymentEntry` books the unallocated part of a
// refund to `customer_deposits`, so `syncTransaction` has to say the memo refund is wholly
// allocated, or `2350` goes negative by every credit ever paid back.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  /** The memo as `readCreditMemoForRefund` finds it. */
  memo: {} as Record<string, unknown>,
  /** Every `database.insert(table).values(...)` call: `[tableName, values]`. */
  inserts: [] as Array<[string, Record<string, unknown>]>,
  /** What `postPaymentTransaction` was handed. */
  posted: [] as Array<{ transaction: Record<string, unknown>; allocatedMinor: number }>,
  settled: [] as string[],
}))

const FIELDS = {
  credit_memo_status: { id: 'f-status' },
  credit_memo_balance: { id: 'f-balance' },
  credit_memo_contact: { id: 'f-contact' },
  credit_memo_invoice: { id: 'f-invoice' },
  invoice_status: { id: 'f-inv-status' },
  invoice_total: { id: 'f-inv-total' },
  invoice_amount_paid: { id: 'f-inv-paid' },
  invoice_amount_credited: { id: 'f-inv-credited' },
  invoice_balance: { id: 'f-inv-balance' },
  credit_memo_application_amount: null,
}

vi.mock('@auxx/database', () => {
  const tableName = (table: unknown) => (table as { __table: string }).__table
  return {
    database: {
      insert: (table: unknown) => ({
        values: (values: Record<string, unknown>) => {
          h.inserts.push([tableName(table), values])
          const row = { id: `${tableName(table)}-1`, createdAt: new Date('2026-09-08'), ...values }
          const promise = Promise.resolve([row]) as Promise<unknown[]> & {
            returning: () => Promise<unknown[]>
          }
          promise.returning = () => Promise.resolve([row])
          return promise
        },
      }),
      query: {
        PaymentAllocation: { findMany: async () => [] },
      },
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
vi.mock('../../cache', () => ({
  getOrgCache: () => ({
    from: () => ({ bySystemAttributes: async () => FIELDS }),
    get: async () => ({}),
  }),
}))
vi.mock('../../resources/crud', () => ({
  UnifiedCrudHandler: class {
    async getFieldValues() {
      const map = new Map<string, unknown>()
      if (h.memo.status)
        map.set(FIELDS.credit_memo_status.id, { type: 'option', optionId: h.memo.status })
      map.set(FIELDS.credit_memo_balance.id, { type: 'number', value: h.memo.balance })
      if (h.memo.contact)
        map.set(FIELDS.credit_memo_contact.id, {
          type: 'relationship',
          recordId: `contact:${h.memo.contact}`,
        })
      if (h.memo.invoice)
        map.set(FIELDS.credit_memo_invoice.id, {
          type: 'relationship',
          recordId: `invoice:${h.memo.invoice}`,
        })
      return map
    }
    async listFiltered() {
      return { ids: [] }
    }
  },
}))
vi.mock('../../field-values/field-value-service', () => ({
  FieldValueService: class {
    async setValuesForEntity() {}
  },
}))
vi.mock('../../field-values/read-field-scalars', () => ({
  readFieldScalars: async () => new Map(),
}))
vi.mock('../../settings/settings-service', () => ({ getOrganizationSetting: async () => 'USD' }))
vi.mock('./post-transaction', () => ({
  postPaymentTransaction: async (
    _db: unknown,
    params: { transaction: Record<string, unknown>; allocatedMinor: number }
  ) => {
    h.posted.push({ transaction: params.transaction, allocatedMinor: params.allocatedMinor })
    return { status: 'posted' }
  },
  listPaymentPostings: async () => [],
}))
vi.mock('./post-deposit-application', () => ({ postDepositApplications: async () => [] }))
vi.mock('../credit-memos/settle', () => ({
  settleCreditMemo: async (_db: unknown, input: { creditMemoInstanceId: string }) => {
    h.settled.push(input.creditMemoInstanceId)
  },
}))

const { recordManualRefund, readCreditMemoForRefund } = await import('./ledger')
const { BadRequestError, NotFoundError } = await import('../../errors')

const ORG = 'org-1'
const USER = 'user-1'
const MEMO = 'memo-1'

const input = {
  organizationId: ORG,
  userId: USER,
  creditMemoInstanceId: MEMO,
  amount: 120,
  date: '2026-09-08',
  method: 'check' as const,
  reference: '1042',
}

beforeEach(() => {
  h.memo = { status: 'issued', balance: 120, contact: 'contact-1', invoice: 'inv-1' }
  h.inserts = []
  h.posted = []
  h.settled = []
})

describe('recordManualRefund - the row', () => {
  it('writes a succeeded manual refund carrying the memo, its contact and its invoice', async () => {
    const { transactionId } = await recordManualRefund(input)
    expect(transactionId).toBe('PaymentTransaction-1')
    const [table, row] = h.inserts[0]!
    expect(table).toBe('PaymentTransaction')
    expect(row).toMatchObject({
      provider: 'manual',
      kind: 'refund',
      status: 'succeeded',
      amount: 120,
      currency: 'USD',
      creditMemoInstanceId: MEMO,
      contactInstanceId: 'contact-1',
      invoiceInstanceId: 'inv-1',
      method: 'check',
      reference: '1042',
      createdByUserId: USER,
      metadata: { date: '2026-09-08' },
    })
  })

  it('carries no invoice when the memo was raised from scratch', async () => {
    h.memo.invoice = undefined
    await recordManualRefund(input)
    expect(h.inserts[0]![1]).toMatchObject({
      invoiceInstanceId: null,
      contactInstanceId: 'contact-1',
    })
  })

  // An allocation is what `computeAmountPaid` subtracts from the invoice. This money settles
  // the memo; the invoice stays exactly as paid as it was (§8 step 3).
  it('writes no PaymentAllocation', async () => {
    await recordManualRefund(input)
    expect(h.inserts.map(([table]) => table)).toEqual(['PaymentTransaction'])
  })

  it('re-derives the memo after the row is written', async () => {
    await recordManualRefund(input)
    expect(h.settled).toEqual([MEMO])
  })
})

describe('recordManualRefund - the posting', () => {
  // `buildPaymentEntry` debits `customer_deposits` for the unallocated part of a refund. A
  // memo refund has no allocation and must still land wholly on `accounts_receivable`, which
  // the memo's issue entry credited.
  it('posts the whole amount as allocated, so the debit lands on accounts_receivable', async () => {
    await recordManualRefund(input)
    expect(h.posted).toHaveLength(1)
    expect(h.posted[0]!.allocatedMinor).toBe(120)
    expect(h.posted[0]!.transaction).toMatchObject({ kind: 'refund', creditMemoInstanceId: MEMO })
  })
})

describe('recordManualRefund - what it refuses', () => {
  it('refuses a zero or negative amount', async () => {
    await expect(recordManualRefund({ ...input, amount: 0 })).rejects.toBeInstanceOf(
      BadRequestError
    )
    await expect(recordManualRefund({ ...input, amount: -5 })).rejects.toBeInstanceOf(
      BadRequestError
    )
    expect(h.inserts).toEqual([])
  })

  it('refuses a fractional amount', async () => {
    await expect(recordManualRefund({ ...input, amount: 12.5 })).rejects.toBeInstanceOf(
      BadRequestError
    )
  })

  it('refuses more than the memo balance', async () => {
    h.memo.balance = 100
    await expect(recordManualRefund(input)).rejects.toThrow(/exceeds the credit memo balance/)
    expect(h.inserts).toEqual([])
  })

  it.each(['draft', 'settled', 'void'])('refuses a memo in status %s', async (status) => {
    h.memo.status = status
    await expect(recordManualRefund(input)).rejects.toThrow(`'${status}'`)
    expect(h.inserts).toEqual([])
  })

  it('refuses a memo that does not resolve', async () => {
    h.memo = {}
    await expect(recordManualRefund(input)).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('readCreditMemoForRefund', () => {
  it('returns the memo the rails share', async () => {
    await expect(
      readCreditMemoForRefund({
        organizationId: ORG,
        userId: USER,
        creditMemoInstanceId: MEMO,
        amount: 50,
      })
    ).resolves.toEqual({
      status: 'issued',
      balance: 120,
      contactInstanceId: 'contact-1',
      invoiceInstanceId: 'inv-1',
    })
  })
})
