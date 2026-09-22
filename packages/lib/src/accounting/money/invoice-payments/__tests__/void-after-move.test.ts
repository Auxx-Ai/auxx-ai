// packages/lib/src/accounting/money/invoice-payments/__tests__/void-after-move.test.ts

/**
 * Record → move → void, against an in-memory `MoneyApplication` table.
 *
 * The void door used to reverse every `apply` row of the movement, including
 * the one the move had already taken back off invoice A, so A read as owing
 * more than its total (LIB-READS §0.1 bug 1). Only `listLiveApplications`
 * closes that, so all three doors run for real here.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  livePosting: null as { id: string } | null,
  totals: new Map<string, number>(),
}))

vi.mock('drizzle-orm', () => ({
  and: (...parts: unknown[]) => ({ op: 'and', parts: parts.filter(Boolean) }),
  or: (...parts: unknown[]) => ({ op: 'or', parts: parts.filter(Boolean) }),
  eq: (col: string, value: unknown) => ({ op: 'eq', col, value }),
  inArray: (col: string, values: unknown[]) => ({ op: 'in', col, values }),
  isNull: () => undefined,
  isNotNull: () => undefined,
  asc: () => undefined,
  desc: () => undefined,
  sql: Object.assign(() => undefined, { raw: () => undefined }),
}))
vi.mock('@auxx/database', () => ({
  database: {},
  schema: new Proxy(
    {},
    {
      get: (_t, table) =>
        new Proxy(
          {},
          {
            get: (_c, column) => {
              if (typeof column === 'symbol') return undefined
              if (column === '__table') return String(table)
              return `${String(table)}.${column}`
            },
          }
        ),
    }
  ),
}))
vi.mock('../../../ledger/reads/list-postings', () => ({
  findLiveSubjectPosting: async () => ({
    isErr: () => false,
    get value() {
      return h.livePosting
    },
  }),
}))
vi.mock('../../../ledger/setup/accounting-enabled', () => ({
  isAccountingEnabled: async () => true,
}))
vi.mock('../../../ledger/periods/period-lock', () => ({ resolvePeriodLock: async () => ({}) }))
vi.mock('../../../ledger/post/reverse-entry', () => ({
  reverseEntry: async () => ({ status: 'posted', glPostingId: 'gl-reversal' }),
}))
vi.mock('../../../ledger/post/ledger-accepted', () => ({ didLedgerAccept: () => true }))
vi.mock('../../../sales/invoices/issuance-reads', () => ({
  loadInvoiceForIssuance: async (_tx: unknown, _org: string, invoiceInstanceId: string) => ({
    totalMinor: h.totals.get(invoiceInstanceId) ?? 0,
    contactInstanceId: 'contact-1',
    number: 'INV-1',
  }),
}))
vi.mock('../payment-state', () => ({ syncInvoicePaymentState: vi.fn(async () => {}) }))

const runMoneyCommand = vi.hoisted(() => vi.fn())
vi.mock('../../commands/run-money-command', () => ({ runMoneyCommand }))

const { recordInvoicePayment } = await import('../record-payment')
const { moveInvoicePayment } = await import('../move-payment')
const { voidInvoicePayment } = await import('../void-payment')
const { sumAppliedToInvoice } = await import('../../reads')
const { netApplied } = await import('../../client')

const ORG = 'org-1'
const INVOICE_A = 'invoice-a'
const INVOICE_B = 'invoice-b'
const TOTAL = 50_000

type Row = Record<string, unknown>
interface Predicate {
  op: string
  parts?: Predicate[]
  col?: string
  value?: unknown
  values?: unknown[]
}

const store = { MoneyTransaction: [] as Row[], MoneyApplication: [] as Row[] }
type TableName = keyof typeof store
let nextId = 0

/** Evaluate the mocked `and`/`eq`/`inArray` tree against one row. */
function matches(row: Row, where: Predicate | undefined): boolean {
  if (!where) return true
  if (where.op === 'and') return (where.parts ?? []).every((part) => matches(row, part))
  if (where.op === 'or') return (where.parts ?? []).some((part) => matches(row, part))
  const column = String(where.col).split('.')[1]!
  if (where.op === 'eq') return row[column] === where.value
  if (where.op === 'in') return (where.values ?? []).includes(row[column])
  return true
}

function table(name: TableName) {
  return {
    findMany: async ({ where }: { where?: Predicate } = {}) =>
      store[name].filter((row) => matches(row, where)),
    findFirst: async ({ where }: { where?: Predicate } = {}) =>
      store[name].find((row) => matches(row, where)),
  }
}

const tx = {
  query: {
    MoneyTransaction: table('MoneyTransaction'),
    MoneyApplication: table('MoneyApplication'),
  },
  insert: (target: { __table: TableName }) => ({
    values: (values: Row) => {
      const row = { id: `row-${++nextId}`, organizationId: ORG, ...values }
      store[target.__table].push(row)
      return { returning: async () => [row] }
    },
  }),
  // The invoice-exists guard: every id this test uses is a live invoice.
  select: () => {
    const chain: Record<string, unknown> = {}
    for (const method of ['from', 'innerJoin', 'where']) chain[method] = () => chain
    chain.limit = async () => [{ id: INVOICE_A }]
    return chain
  },
}

beforeEach(() => {
  store.MoneyTransaction = []
  store.MoneyApplication = []
  nextId = 0
  h.livePosting = null
  h.totals = new Map([
    [INVOICE_A, TOTAL],
    [INVOICE_B, TOTAL],
  ])
  runMoneyCommand.mockReset()
  runMoneyCommand.mockImplementation(
    async (
      _db: unknown,
      _command: unknown,
      body: (tx: unknown, commandId: string) => Promise<unknown>
    ) => body(tx, `command-${++nextId}`)
  )
})

const db = { transaction: async (fn: (tx: unknown) => unknown) => fn(tx) } as never

describe('voiding a payment that was moved first', () => {
  it('reverses only the application that is still standing', async () => {
    const recorded = await recordInvoicePayment(db, {
      organizationId: ORG,
      userId: 'user-1',
      invoiceInstanceId: INVOICE_A,
      amountMinor: TOTAL,
      date: '2026-09-01',
      method: 'check',
      commandKey: 'record',
    })
    const applyToA = store.MoneyApplication[0]!

    await moveInvoicePayment(db, {
      organizationId: ORG,
      userId: 'user-1',
      moneyTransactionId: recorded.moneyTransactionId,
      fromInvoiceInstanceId: INVOICE_A,
      toInvoiceInstanceId: INVOICE_B,
      amountMinor: TOTAL,
      effectiveDate: '2026-09-02',
      commandKey: 'move',
    })

    // The receipt's own entry lands after the move; the void reverses it.
    h.livePosting = { id: 'gl-receipt' }
    await voidInvoicePayment(db, {
      organizationId: ORG,
      userId: 'user-1',
      moneyTransactionId: recorded.moneyTransactionId,
      commandKey: 'void',
    })

    const reversalsOfA = store.MoneyApplication.filter(
      (row) => row.reversesApplicationId === applyToA.id
    )
    expect(reversalsOfA).toHaveLength(1)

    const onA = store.MoneyApplication.filter((row) => row.invoiceInstanceId === INVOICE_A)
    expect(netApplied(onA as never)).toBe(0n)
    const settled = await sumAppliedToInvoice(tx as never, ORG, INVOICE_A)
    expect(BigInt(TOTAL) - settled).toBe(BigInt(TOTAL))
  })
})
