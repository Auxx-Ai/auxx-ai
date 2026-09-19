// packages/lib/src/accounting/money/vendor-payments/__tests__/record-payment.test.ts
//
// The vendor payment writer: a `vendor_payment` movement plus one
// `MoneyApplication` naming the bill, and nothing written onto the bill by hand.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  inserts: [] as Array<[string, Record<string, unknown>]>,
  postings: [
    { glPostingId: 'gp_1', docNumber: 'BILL-1', status: 'posted', postingType: 'expense_bill' },
  ] as Array<Record<string, unknown>>,
  applications: [] as Array<Record<string, unknown>>,
  scalars: new Map<string, unknown>(),
  billRows: [{ id: 'vb_1' }] as unknown[],
  vendorRows: [{ relatedEntityId: 'co_1' }] as unknown[],
  syncState: vi.fn(),
}))

vi.mock('../../commands/run-money-command', () => ({
  runMoneyCommand: async (
    db: unknown,
    _input: unknown,
    run: (tx: unknown, commandId: string) => unknown
  ) => run(db, 'cmd_1'),
}))
vi.mock('../payment-state', () => ({ syncVendorBillPaymentState: h.syncState }))
vi.mock('../../../../purchasing/expense-bill/writes', () => ({
  listVendorBillPostings: async () => h.postings,
}))
vi.mock('../../../../cache', () => ({
  requireCachedEntityDefId: async () => 'def_vendor_bill',
  getOrgCache: () => ({
    from: () => ({
      bySystemAttributes: async () => ({
        vendor_bill_total: { id: 'f_total', type: 'CURRENCY' },
        vendor_bill_vendor: { id: 'f_vendor', type: 'RELATIONSHIP' },
      }),
    }),
  }),
}))
vi.mock('../../../../field-values/read-field-scalars', () => ({
  readFieldScalars: async () => new Map([['vb_1', h.scalars]]),
}))
vi.mock('drizzle-orm', () => ({
  and: () => undefined,
  eq: () => undefined,
  isNull: () => undefined,
}))
vi.mock('@auxx/database', () => {
  const tableName = (table: unknown) => (table as { __table: string }).__table
  return {
    database: {},
    schema: new Proxy({}, { get: (_t, table) => ({ __table: String(table) }) }),
  }
})

const { recordVendorPayment } = await import('../record-payment')

const input = {
  organizationId: 'org_1',
  userId: 'user_1',
  vendorBillInstanceId: 'vb_1',
  amountMinor: 45_000,
  date: '2026-09-15',
  method: 'bank' as const,
  commandKey: 'dialog-1',
  reference: 'ACH-77',
}

function tx() {
  let selectCall = 0
  const chain: Record<string, unknown> = {}
  for (const method of ['from', 'where', 'limit']) chain[method] = () => chain
  // biome-ignore lint/suspicious/noThenProperty: a drizzle builder is thenable
  chain.then = (resolve: (rows: unknown[]) => unknown) =>
    Promise.resolve(selectCall++ === 0 ? h.billRows : h.vendorRows).then(resolve)
  return {
    select: () => chain,
    query: { MoneyApplication: { findMany: async () => h.applications } },
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        const name = (table as { __table: string }).__table
        h.inserts.push([name, values])
        return { returning: async () => [{ id: `${name}-1` }] }
      },
    }),
  }
}

const run = (overrides: Partial<Parameters<typeof recordVendorPayment>[1]> = {}) =>
  recordVendorPayment(tx() as never, { ...input, ...overrides })

beforeEach(() => {
  vi.clearAllMocks()
  h.inserts = []
  h.applications = []
  h.billRows = [{ id: 'vb_1' }]
  h.vendorRows = [{ relatedEntityId: 'co_1' }]
  h.postings = [
    { glPostingId: 'gp_1', docNumber: 'BILL-1', status: 'posted', postingType: 'expense_bill' },
  ]
  h.scalars = new Map<string, unknown>([['f_total', 100_000]])
})

describe('recordVendorPayment', () => {
  it('writes the movement and one application naming the bill', async () => {
    await expect(run()).resolves.toEqual({
      moneyTransactionId: 'MoneyTransaction-1',
      moneyApplicationId: 'MoneyApplication-1',
    })
    expect(h.inserts.map(([table]) => table)).toEqual(['MoneyTransaction', 'MoneyApplication'])
    expect(h.inserts[0]![1]).toMatchObject({
      purpose: 'vendor_payment',
      amountMinor: 45_000n,
      currency: 'USD',
      datePrecision: 'date',
      occurredOn: '2026-09-15',
      partyInstanceId: 'co_1',
      cashAccountInstanceId: null,
      paymentGatewayId: null,
      method: 'bank',
      reference: 'ACH-77',
    })
    expect(h.inserts[1]![1]).toMatchObject({
      operation: 'apply',
      amountMinor: 45_000n,
      vendorBillInstanceId: 'vb_1',
      commandItemKey: 'vendor_bill_payment',
    })
  })

  it('projects the bill state rather than writing its fields by hand', async () => {
    await run()
    expect(h.syncState).toHaveBeenCalledOnce()
  })

  it('stamps the bank account the money left', async () => {
    await run({ bankAccountInstanceId: 'ba_1' })
    expect(h.inserts[0]![1]).toMatchObject({
      cashAccountInstanceId: 'ba_1',
      paymentGatewayId: null,
    })
  })

  it('stamps the rail the money left on', async () => {
    await run({ paymentGatewayId: 'pg_1' })
    expect(h.inserts[0]![1]).toMatchObject({
      cashAccountInstanceId: null,
      paymentGatewayId: 'pg_1',
    })
  })

  it('refuses a payment naming both a rail and a bank account', async () => {
    await expect(run({ paymentGatewayId: 'pg_1', bankAccountInstanceId: 'ba_1' })).rejects.toThrow(
      /never both/
    )
    expect(h.inserts).toEqual([])
  })

  it.each([0, -5, 12.5])('refuses the amount %s', async (amountMinor) => {
    await expect(run({ amountMinor })).rejects.toThrow(/positive whole number/)
    expect(h.inserts).toEqual([])
  })

  it('refuses a date that is not a calendar day', async () => {
    await expect(run({ date: '15/09/2026' })).rejects.toThrow(/calendar date/)
  })

  it('refuses more than the bill still owes', async () => {
    h.applications = [{ operation: 'apply', amountMinor: 70_000n }]
    await expect(run()).rejects.toThrow(/more than the 30000 cents/)
  })

  // 73 D1: the gate is the ledger, not the lifecycle.
  it('refuses a bill with no general ledger entry behind it', async () => {
    h.postings = []
    await expect(run()).rejects.toThrow(/not in the books yet/)
    expect(h.inserts).toEqual([])
  })

  it('refuses a bill whose only posting has been reversed', async () => {
    h.postings = [
      { glPostingId: 'gp_1', docNumber: 'BILL-1', status: 'reversed', postingType: 'expense_bill' },
    ]
    await expect(run()).rejects.toThrow(/not in the books yet/)
  })

  it('pays a matched PO bill, whose posting came from the match hook', async () => {
    h.postings = [
      {
        glPostingId: 'gp_2',
        docNumber: 'PB-1',
        status: 'posted',
        postingType: 'purchasing_bill',
      },
    ]
    await expect(run()).resolves.toMatchObject({ moneyTransactionId: 'MoneyTransaction-1' })
  })
})
