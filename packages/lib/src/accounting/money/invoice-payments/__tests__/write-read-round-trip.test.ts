// packages/lib/src/accounting/money/invoice-payments/__tests__/write-read-round-trip.test.ts

/**
 * What was WRITTEN is what is LISTED — the gap named in 54-HANDOFF §5.4.
 *
 * `record-payment.test.ts` stubs the read away and `payment-reads.test.ts`
 * stubs the write away, so between them nothing asserts that a payment the
 * drawer records is a payment the drawer can then show. That is not a
 * hypothetical: repointing the write door at the money model in #2186 without
 * `payment-reads.ts` would have left every recorded payment invisible, and both
 * files would still have been green.
 *
 * So this test runs the REAL `recordInvoicePayment` against a transaction stub
 * that captures the rows it inserts, joins those captured rows the way the read
 * door's `innerJoin` does, and feeds them to the REAL
 * `listInvoiceMoneyPayments`. Neither side is mocked; only the database
 * between them is. A column written but never projected — or projected under a
 * name the writer does not set — fails here.
 *
 * 🛑 The join below must keep selecting BY COLUMN NAME off the captured insert
 * values. Hand-shaping a row to match what the reader expects would make this
 * pass while the two doors disagreed, which is the exact failure it exists to
 * catch.
 */

import { schema } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const settings = vi.hoisted(() => ({ value: {} as Record<string, unknown> }))
const loadInvoice = vi.hoisted(() => vi.fn())

vi.mock('../../../../cache/singletons', () => ({
  getOrgCache: () => ({ get: async () => settings.value }),
}))
vi.mock('../../../sales/invoices/issuance-reads', () => ({
  loadInvoiceForIssuance: loadInvoice,
}))
// The invoice mirror projection is its own writer with its own test; this one
// is about what the payment doors write and read.
vi.mock('../payment-state', () => ({ syncInvoicePaymentState: vi.fn(async () => {}) }))

// The command runner is replaced by one that actually RUNS the writer's
// callback — the point is to exercise the inserts, not to skip them.
const runMoneyCommand = vi.hoisted(() => vi.fn())
vi.mock('../../commands/run-money-command', () => ({ runMoneyCommand }))

const { recordInvoicePayment } = await import('../record-payment')
const { listInvoiceMoneyPayments } = await import('../payment-reads')

const ORG = 'org-1'
const INVOICE = 'invoice-1'

/** Every row the writer inserted, keyed by the table it went to. */
interface Captured {
  MoneyTransaction: Record<string, unknown>[]
  MoneyApplication: Record<string, unknown>[]
}

/** Which captured list an `insert(table)` belongs to. */
function tableKey(table: unknown): keyof Captured {
  if (table === schema.MoneyTransaction) return 'MoneyTransaction'
  if (table === schema.MoneyApplication) return 'MoneyApplication'
  throw new Error('recordInvoicePayment inserted into an unexpected table')
}

/**
 * A transaction stub that answers the two reads `readInvoiceBalance` makes and
 * records the two inserts the writer makes.
 */
function stubTx(captured: Captured, existingApplications: Record<string, unknown>[]) {
  const selectChain = {
    from: () => selectChain,
    innerJoin: () => selectChain,
    where: () => selectChain,
    limit: async () => [{ id: INVOICE }],
  }
  return {
    select: () => selectChain,
    query: {
      MoneyApplication: { findMany: async () => existingApplications },
    },
    insert: (table: unknown) => {
      // 🔑 By REFERENCE, not by name: `src/test/setup.ts` mocks `@auxx/database`
      // with a memoized proxy whose tables are bare `{}`, so identity is the
      // only thing that distinguishes them. A writer aimed at the wrong table
      // lands here as an unexpected insert rather than passing silently.
      const name = tableKey(table)
      return {
        values: (row: Record<string, unknown>) => ({
          returning: async () => {
            const list = captured[name]
            list.push(row)
            return [{ id: `${name}-${list.length}` }]
          },
        }),
      }
    },
  } as never
}

/**
 * The read door's `innerJoin`, performed on captured rows.
 *
 * Selects exactly the columns `listInvoiceMoneyPayments` selects, by the names
 * the writer inserted them under.
 */
function joinAsReadDoor(captured: Captured) {
  return captured.MoneyApplication.filter(
    (application) => application.invoiceInstanceId === INVOICE
  ).map((application) => {
    const money = captured.MoneyTransaction.find(
      (_row, index) => `MoneyTransaction-${index + 1}` === application.moneyTransactionId
    )
    if (!money) throw new Error('application points at no money transaction')
    return {
      amountMinor: application.amountMinor,
      operation: application.operation,
      moneyTransactionId: application.moneyTransactionId,
      createdAt: new Date('2026-09-15T00:00:00Z'),
      purpose: money.purpose,
      occurredAt: money.occurredAt ?? null,
      occurredOn: money.occurredOn ?? null,
      method: money.method ?? null,
      reference: money.reference ?? null,
      note: money.note ?? null,
    }
  })
}

function stubReadDb(rows: unknown[]) {
  const chain = {
    from: () => chain,
    innerJoin: () => chain,
    where: () => chain,
    orderBy: async () => rows,
  }
  return { select: () => chain } as never
}

const input = {
  organizationId: ORG,
  userId: 'user-1',
  invoiceInstanceId: INVOICE,
  amountMinor: 50_000,
  date: '2026-09-16',
  method: 'cash' as const,
  reference: 'T54-E2E-1',
  note: 'paid at the counter',
  commandKey: 'dialog-1',
}

let captured: Captured

beforeEach(() => {
  captured = { MoneyTransaction: [], MoneyApplication: [] }
  settings.value = {}
  loadInvoice.mockReset()
  loadInvoice.mockResolvedValue({
    number: 'INV-0001',
    issuedAt: '2026-09-08',
    subtotalMinor: 158_900,
    taxTotalMinor: 14_301,
    totalMinor: 157_311,
    contactInstanceId: 'contact-1',
  })
  runMoneyCommand.mockReset()
  runMoneyCommand.mockImplementation(
    async (_db: unknown, _command: unknown, run: (tx: never, commandId: string) => unknown) =>
      run(stubTx(captured, []) as never, 'command-1')
  )
})

describe('a recorded payment round-trips to the drawer', () => {
  it('lists the receipt it just wrote, carrying every field the recorder set', async () => {
    await recordInvoicePayment({} as never, input)

    const [row] = await listInvoiceMoneyPayments(stubReadDb(joinAsReadDoor(captured)), {
      organizationId: ORG,
      invoiceInstanceId: INVOICE,
    })

    expect(row).toMatchObject({
      amount: 50_000,
      allocatedAmount: 50_000,
      kind: 'charge',
      status: 'succeeded',
      // The day the recorder typed, not a day derived from a timezone: a
      // hand-recorded payment is `date` precision and must survive as typed.
      date: '2026-09-16',
      method: 'cash',
      reference: 'T54-E2E-1',
      note: 'paid at the counter',
      // `payments-list.tsx` keys Void off this, so a money row that came back
      // labelled anything else would offer the legacy lane's Delete instead.
      provider: 'money',
    })
  })

  it('writes cash with no bank account and still lists it', async () => {
    await recordInvoicePayment({} as never, input)

    // Undeposited funds is a ROLE, not an account — the absence here is the
    // record of money received and not yet banked, and it must not stop the
    // row from reaching the drawer.
    expect(captured.MoneyTransaction[0]?.cashAccountInstanceId).toBeNull()
    const rows = await listInvoiceMoneyPayments(stubReadDb(joinAsReadDoor(captured)), {
      organizationId: ORG,
      invoiceInstanceId: INVOICE,
    })
    expect(rows).toHaveLength(1)
  })

  it('drops the row once a void unapplies the whole receipt', async () => {
    await recordInvoicePayment({} as never, input)

    // What `voidInvoicePayment` adds: the reversing application against the
    // same movement. The pair nets to nothing and the drawer shows no payment.
    const applied = captured.MoneyApplication[0]
    if (!applied) throw new Error('nothing was applied')
    captured.MoneyApplication.push({
      ...applied,
      operation: 'unapply',
      reversesApplicationId: 'MoneyApplication-1',
    })

    const rows = await listInvoiceMoneyPayments(stubReadDb(joinAsReadDoor(captured)), {
      organizationId: ORG,
      invoiceInstanceId: INVOICE,
    })
    expect(rows).toEqual([])
  })

  it('shows the remainder when only part of the receipt is unapplied', async () => {
    await recordInvoicePayment({} as never, input)

    const applied = captured.MoneyApplication[0]
    if (!applied) throw new Error('nothing was applied')
    captured.MoneyApplication.push({
      ...applied,
      operation: 'unapply',
      amountMinor: 20_000n,
    })

    const [row] = await listInvoiceMoneyPayments(stubReadDb(joinAsReadDoor(captured)), {
      organizationId: ORG,
      invoiceInstanceId: INVOICE,
    })
    expect(row?.amount).toBe(30_000)
  })
})
