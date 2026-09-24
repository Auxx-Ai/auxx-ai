// packages/lib/src/accounting/export/__tests__/build-batches-posters.test.ts
//
// The build fed the REAL posters' lines, not hand-made fixtures: fixtures that gave the cash line
// a role no poster wrote are what hid 101 §2.10. Each poster runs for real down to `postEntry`;
// its entry is stored the way `post-entry.ts` stores it and handed to `buildExportBatches`.

import { ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  postEntry: vi.fn(),
  resolveRoles: vi.fn(),
  readCustomerReceiptAccountingSource: vi.fn(),
  readActiveBookConnection: vi.fn(),
  readExportSettings: vi.fn(),
  settings: {} as Record<string, unknown>,
  money: null as unknown,
  disputes: [] as unknown[],
}))

vi.mock('../../ledger/setup/accounting-enabled', () => ({ isAccountingActive: async () => true }))
vi.mock('../../ledger/setup/setup-readiness', () => ({ FINALIZED_SETUP_STATE: 'finalized' }))
vi.mock('../../ledger/post/post-entry', () => ({ postEntry: h.postEntry }))
vi.mock('../../ledger/reads/list-postings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../ledger/reads/list-postings')>()),
  findLiveSubjectPosting: async () => ok(null),
}))
vi.mock('../../ledger/periods/period-lock', () => ({
  resolvePeriodLock: async () => ({ lockedThroughMonth: null }),
}))
vi.mock('../../ledger/roles/resolve-roles', () => ({ resolveRoles: h.resolveRoles }))
vi.mock('../../../settings/settings-service', () => ({
  getOrganizationSetting: async ({ key }: { key: string }) => h.settings[key] ?? null,
}))
vi.mock('../../../settings/read', () => ({
  readOrganizationSettings: async (_org: string, keys: readonly string[]) =>
    Object.fromEntries(keys.map((key) => [key, h.settings[key] ?? null])),
}))
vi.mock('../../money/customer-money/receipt-accounting', () => ({
  readCustomerReceiptAccountingSource: h.readCustomerReceiptAccountingSource,
}))
vi.mock('../../sales/invoices/issuance-reads', () => ({
  loadInvoiceForIssuance: async () => ({ number: 'INV-1', contactInstanceId: 'ct_1' }),
}))
vi.mock('../../work-items/write', () => ({
  upsertWorkItem: async () => ({ isErr: () => false }),
  deleteWorkItem: async () => ({ isErr: () => false }),
}))
vi.mock('../../providers/book-connections', () => ({
  readActiveBookConnection: h.readActiveBookConnection,
}))
vi.mock('../../ledger/setup/read-export-settings', () => ({
  readExportSettings: h.readExportSettings,
}))
vi.mock('../../ledger/reads/ledger-summary', () => ({ readLedgerSummary: async () => ok([]) }))
vi.mock('@auxx/logger', () => ({
  createScopedLogger: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}))

import { type Database, schema } from '@auxx/database'
import { toLineRows } from '../../ledger/post/insert-posting'
import { avenueOfPostingType } from '../../ledger/setup/export-settings'
import type { BuiltEntry } from '../../ledger/types'
import { postCustomerReceiptAccounting } from '../../money/customer-money/accounting'
import { postCustomerRefundAccounting } from '../../money/customer-money/refund-accounting'
import { acceptInvoiceReceiptAccounting } from '../../money/invoice-payments/receipt-accounting'
import { buildExportBatches } from '../build-batches'

const ORG = 'org_1'
const MOVEMENT = 'mt_1'
const RANGE = { organizationId: ORG, from: '2026-09-01', to: '2026-09-30' }
/** What each role resolves to when `postEntry` stores a role line. */
const ROLE_ACCOUNTS: Record<string, string> = {
  accounts_receivable: 'gl_ar',
  payment_processing_fees: 'gl_fees',
}

/** The poster's db: every read the three posters make, answered from `h`. */
function posterDb(): Database {
  const select = () => {
    let table: unknown
    const chain: Record<string, unknown> = {}
    chain.from = (from: unknown) => {
      table = from
      return chain
    }
    for (const method of ['innerJoin', 'leftJoin', 'where', 'orderBy', 'limit'])
      chain[method] = () => chain
    // biome-ignore lint/suspicious/noThenProperty: a drizzle builder is thenable
    chain.then = (resolve: (rows: unknown[]) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(
        table === schema.EntityInstance
          ? [{ id: 'inv_1' }]
          : table === schema.ProcessorBalanceEntry
            ? h.disputes
            : []
      ).then(resolve, reject)
    return chain
  }
  const tx = {
    select,
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    query: {
      MoneyTransaction: {
        findFirst: async () => h.money,
        findMany: async () => (h.money ? [h.money] : []),
      },
      MoneyApplication: {
        findMany: async () => [
          { id: 'ma_1', operation: 'apply', invoiceInstanceId: 'inv_1', amountMinor: 12_000n },
        ],
      },
      MoneyRefundSettlement: { findMany: async () => [] },
    },
  }
  return {
    ...tx,
    transaction: async <T>(fn: (t: unknown) => Promise<T>) => fn(tx),
  } as unknown as Database
}

function movement(over: Record<string, unknown>) {
  return {
    id: MOVEMENT,
    organizationId: ORG,
    amountMinor: 12_000n,
    currency: 'USD',
    currencyExponent: 2,
    datePrecision: 'date',
    occurredOn: '2026-09-15',
    occurredAt: null,
    partyInstanceId: 'ct_1',
    cashAccountInstanceId: null,
    paymentGatewayId: null,
    method: null,
    ...over,
  }
}

/** The entry the poster handed `postEntry`, stored as `post-entry.ts` + `toLineRows` store it. */
function storedLines(glPostingId: string) {
  const entry = h.postEntry.mock.calls.at(-1)![1].entry as BuiltEntry
  const rows = toLineRows(
    ORG,
    glPostingId,
    entry.lines.map((line) => {
      const glAccountId = line.glAccountId ?? ROLE_ACCOUNTS[line.accountRole ?? '']!
      return {
        accountRole: line.accountRole ?? null,
        resolved: { ...line, glAccountId, accountCode: glAccountId.toUpperCase() },
      }
    })
  )
  return { entry, rows }
}

/** `select()` answers in order; `insert()` records the batch rows. */
function exportDb(selects: unknown[][]) {
  let call = 0
  const inserted: Array<Record<string, unknown>> = []
  const chain: Record<string, unknown> = {}
  for (const method of ['from', 'leftJoin', 'innerJoin', 'where', 'orderBy', 'limit'])
    chain[method] = () => chain
  // biome-ignore lint/suspicious/noThenProperty: the fake must be awaitable
  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(selects[call++] ?? []).then(resolve)
  const tx = {
    insert: () => {
      let pending: Record<string, unknown> | undefined
      const insert: Record<string, unknown> = {}
      insert.values = (values: Record<string, unknown> | Record<string, unknown>[]) => {
        if (!Array.isArray(values)) pending = values
        return insert
      }
      insert.onConflictDoNothing = () => insert
      insert.returning = async () => {
        if (!pending) return []
        inserted.push(pending)
        return [{ id: `batch_${inserted.length}` }]
      }
      // biome-ignore lint/suspicious/noThenProperty: a member insert is awaited directly
      insert.then = (resolve: (v: unknown) => unknown) => Promise.resolve([]).then(resolve)
      return insert
    },
  }
  const db = {
    select: () => chain,
    transaction: (fn: (t: unknown) => unknown) => fn(tx),
  } as unknown as Database
  return { db, inserted }
}

function postingRow(id: string, postingType: 'payment' | 'refund', totalMinor: number) {
  return {
    id,
    postingType,
    avenue: avenueOfPostingType(postingType),
    txnDate: '2026-09-15',
    docNumber: `${postingType.toUpperCase()}-1`,
    currency: 'USD',
    storeId: null,
    railId: null,
    totalMinor,
    built: {},
    batchedId: null,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.settings = {
    'accounting.setupState': 'finalized',
    'accounting.bookTimeZone': 'America/Los_Angeles',
    'accounting.guestContactId': 'ct_guest',
  }
  h.disputes = []
  h.postEntry.mockResolvedValue({ status: 'posted', glPostingId: 'glp_posted' })
  h.resolveRoles.mockResolvedValue(
    ok(
      new Map([
        ['clearing', { glAccountId: 'gl_clearing' }],
        ['undeposited_funds', { glAccountId: 'gl_undep' }],
      ])
    )
  )
  h.readActiveBookConnection.mockResolvedValue({
    id: 'conn_1',
    connectionId: 'conn_1',
    bookId: 'book_1',
    exportFromDate: '2026-01-01',
  })
  h.readExportSettings.mockResolvedValue({
    mode: 'transaction',
    cutover: null,
    autoSend: {},
    summaryGrain: {},
  })
})

describe('101 E8 + E1: the build over real poster output', () => {
  it('a channel receipt stores its cash line with its role and leaves as a Payment', async () => {
    h.money = movement({ purpose: 'customer_receipt' })
    h.readCustomerReceiptAccountingSource.mockResolvedValue({
      money: h.money,
      orderId: 'order_1',
      paymentGatewayId: 'pg_1',
      sourceStoreId: 'store_1',
      sourceProvider: 'shopify',
      sourceExternalId: 'capture_1',
      gatewayName: 'Shopify Payments',
      storeDomain: 'demo.myshopify.com',
    })
    await postCustomerReceiptAccounting(posterDb(), {
      organizationId: ORG,
      moneyTransactionId: MOVEMENT,
    })
    const { rows } = storedLines('glp_pay')
    expect(rows[0]).toMatchObject({
      glAccountId: 'gl_clearing',
      accountRole: 'clearing',
      direction: 'debit',
    })

    const { db, inserted } = exportDb([
      [postingRow('glp_pay', 'payment', 12_000)],
      [{ glPostingId: 'glp_pay', sourceKind: 'order', sourceId: 'order_1' }],
      [{ sourceKind: 'order', sourceId: 'order_1', glPostingId: 'glp_ful' }],
      rows,
    ])
    await buildExportBatches(db, RANGE)

    expect(inserted[0]).toMatchObject({ objectType: 'payment', grainKey: 'glp_pay' })
    expect(inserted[0]?.payload).toMatchObject({
      appliesTo: { glPostingId: 'glp_ful' },
      depositTo: { glAccountId: 'gl_clearing' },
    })
  })

  it('an invoice receipt into undeposited funds leaves as a Payment', async () => {
    h.money = movement({ purpose: 'customer_receipt', method: 'check' })
    await acceptInvoiceReceiptAccounting(posterDb(), {
      organizationId: ORG,
      moneyTransactionId: MOVEMENT,
    })
    const { rows } = storedLines('glp_pay')
    expect(rows[0]).toMatchObject({ glAccountId: 'gl_undep', accountRole: 'undeposited_funds' })

    const { db, inserted } = exportDb([
      [postingRow('glp_pay', 'payment', 12_000)],
      [{ glPostingId: 'glp_pay', sourceKind: 'invoice', sourceId: 'inv_1' }],
      [{ sourceKind: 'invoice', sourceId: 'inv_1', glPostingId: 'glp_inv' }],
      rows,
    ])
    await buildExportBatches(db, RANGE)

    expect(inserted[0]).toMatchObject({ objectType: 'payment' })
    expect(inserted[0]?.payload).toMatchObject({ appliesTo: { glPostingId: 'glp_inv' } })
  })

  it('a refund stores its cash line with its role and leaves as a journal', async () => {
    h.money = movement({ purpose: 'customer_refund', paymentGatewayId: 'pg_1' })
    await postCustomerRefundAccounting(posterDb(), {
      organizationId: ORG,
      moneyTransactionId: MOVEMENT,
    })
    const { rows } = storedLines('glp_rfd')
    expect(rows.map((row) => [row.accountRole, row.direction])).toEqual([
      ['accounts_receivable', 'debit'],
      ['clearing', 'credit'],
    ])

    const { db, inserted } = exportDb([[postingRow('glp_rfd', 'refund', 12_000)], rows])
    const built = await buildExportBatches(db, RANGE)

    expect(built._unsafeUnwrap().built).toBe(1)
    expect(inserted[0]).toMatchObject({ objectType: 'journal', grainKey: 'glp_rfd' })
  })

  it('a chargeback with its dispute fee leaves as a journal', async () => {
    h.money = movement({ purpose: 'customer_refund', paymentGatewayId: 'pg_1' })
    h.disputes = [{ feeMinor: 1_500n }]
    await postCustomerRefundAccounting(posterDb(), {
      organizationId: ORG,
      moneyTransactionId: MOVEMENT,
    })
    const { rows } = storedLines('glp_cb')
    expect(rows.map((row) => row.accountRole)).toEqual([
      'accounts_receivable',
      'payment_processing_fees',
      'clearing',
    ])

    const { db, inserted } = exportDb([[postingRow('glp_cb', 'refund', 13_500)], rows])
    await buildExportBatches(db, RANGE)

    expect(inserted[0]).toMatchObject({ objectType: 'journal' })
  })
})
