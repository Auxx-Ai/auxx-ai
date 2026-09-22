// packages/lib/src/accounting/export/__tests__/build-batches.test.ts
//
// The build's properties: it is IDEMPOTENT in both modes - a second run over a
// range that already has its batches writes nothing - it never touches a
// posting dated before the cutover, and in Transaction mode it now shapes each
// posting into its native provider object (plan 67), falling back to `journal`
// when a posting's lines do not fit. A fake db in `post-entry.test.ts`'s style:
// what is exercised is the builder's own selection, not Postgres.

import type { Database } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const readActiveBookConnection = vi.fn()
vi.mock('../../providers/book-connections', () => ({
  readActiveBookConnection: (...a: unknown[]) => readActiveBookConnection(...a),
}))

const readExportSettings = vi.fn()
vi.mock('../../ledger/setup/read-export-settings', () => ({
  readExportSettings: (...a: unknown[]) => readExportSettings(...a),
}))

const readLedgerSummary = vi.fn()
vi.mock('../../ledger/reads/ledger-summary', () => ({
  readLedgerSummary: (...a: unknown[]) => readLedgerSummary(...a),
}))

const h = vi.hoisted(() => ({ debug: vi.fn() }))
vi.mock('@auxx/logger', () => ({
  createScopedLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: h.debug }),
}))

import { ok } from 'neverthrow'
import { avenueOfPostingType } from '../../ledger/setup/export-settings'
import type { PostingType } from '../../ledger/types'
import { buildExportBatches } from '../build-batches'

const ORG = 'org_1'
const CUSTOMER = { counterpartyType: 'customer', counterpartyId: 'cust_1' }
const CONNECTION = { connectionId: 'conn_1', bookId: 'book_1', exportFromDate: '2026-01-01' }

function posting(over: Partial<Record<string, unknown>> = {}) {
  const row = {
    id: 'glp_1',
    postingType: 'fulfillment',
    txnDate: '2026-09-14',
    docNumber: 'FUL-20260914',
    currency: 'USD',
    storeId: null,
    railId: null,
    totalMinor: 5000,
    built: {},
    batchedId: null,
    ...over,
  }
  // The builder reads the stored column, which the poster derives the same way.
  return { ...row, avenue: avenueOfPostingType(row.postingType as PostingType) }
}

function line(over: Partial<Record<string, unknown>> = {}) {
  return {
    glPostingId: 'glp_1',
    glAccountId: 'acct_a',
    accountCode: '1100',
    accountName: 'A/R',
    accountRole: null,
    direction: 'debit',
    amountMinor: 5000,
    lineNumber: 0,
    memo: null,
    counterpartyType: null,
    counterpartyId: null,
    ...over,
  }
}

/**
 * `select()` answers in order, `insert()` records what it was handed.
 *
 * `inserted` carries only the batch rows an insert actually returned a row
 * for, which is what `onConflictDoNothing` decides in production. `members`
 * carries every `ExportBatchPosting` array an insert was handed, in call order.
 */
function fakeDb(selects: unknown[][], options: { conflict?: boolean } = {}) {
  let call = 0
  const inserted: Array<Record<string, unknown>> = []
  const members: Array<Array<Record<string, unknown>>> = []
  const wheres: unknown[] = []
  const selectChain: Record<string, unknown> = {}
  const passthrough = () => selectChain
  for (const method of ['from', 'leftJoin', 'innerJoin', 'orderBy', 'limit'])
    selectChain[method] = passthrough
  selectChain.where = (condition: unknown) => {
    wheres.push(condition)
    return selectChain
  }
  // biome-ignore lint/suspicious/noThenProperty: the fake must be awaitable
  selectChain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
    const rows = selects[call] ?? []
    call += 1
    return Promise.resolve(rows).then(resolve, reject)
  }

  const tx = {
    insert: () => {
      let pending: Record<string, unknown> | undefined
      const chain: Record<string, unknown> = {}
      chain.values = (values: Record<string, unknown> | Record<string, unknown>[]) => {
        if (Array.isArray(values)) members.push(values)
        else pending = values
        return chain
      }
      chain.onConflictDoNothing = () => chain
      chain.returning = async () => {
        if (!pending) return []
        if (options.conflict) return []
        inserted.push(pending)
        return [{ id: `batch_${inserted.length}` }]
      }
      // A member insert has no `.returning()`; it is awaited directly.
      // biome-ignore lint/suspicious/noThenProperty: the fake must be awaitable
      chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve([]).then(resolve)
      return chain
    },
  }

  const db = {
    select: () => selectChain,
    transaction: (fn: (tx: unknown) => unknown) => fn(tx),
  } as unknown as Database
  return { db, inserted, members, wheres }
}

/** Every string bound into a drizzle condition, so a test can see what a `where` carried. */
function boundValues(condition: unknown): string[] {
  const out: string[] = []
  const visit = (node: unknown): void => {
    if (node == null) return
    if (Array.isArray(node)) {
      for (const child of node) visit(child)
      return
    }
    if (typeof node === 'string') {
      out.push(node)
      return
    }
    if (typeof node === 'object') {
      const record = node as Record<string, unknown>
      if ('queryChunks' in record) visit(record.queryChunks)
      else if ('value' in record) visit(record.value)
    }
  }
  visit(condition)
  return out
}

beforeEach(() => {
  vi.clearAllMocks()
  readActiveBookConnection.mockResolvedValue(CONNECTION)
  readExportSettings.mockResolvedValue({
    mode: 'transaction',
    cutover: null,
    autoSend: {},
    summaryGrain: {},
  })
  readLedgerSummary.mockResolvedValue(ok([]))
})

const RANGE = { organizationId: ORG, from: '2026-09-01', to: '2026-09-30' }

describe('Transaction mode', () => {
  it('builds one batch per posted, un-batched posting, falling back to journal with no role data', async () => {
    const { db, inserted } = fakeDb([[posting()], [line(), line({ direction: 'credit' })]])

    const result = await buildExportBatches(db, RANGE)

    expect(result._unsafeUnwrap().built).toBe(1)
    expect(inserted[0]).toMatchObject({
      mode: 'transaction',
      avenue: 'fulfillment',
      // The posting id IS the grain: one posting, one batch.
      grainKey: 'glp_1',
      state: 'ready',
      // No role data on the lines (a legacy/manual entry) - falls back to journal.
      objectType: 'journal',
      totalMinor: 5000,
    })
    expect(inserted[0]?.payloadHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('builds nothing twice - a batched posting is simply not a candidate', async () => {
    const { db, inserted } = fakeDb([[posting({ batchedId: 'ebp_1' })]])

    const result = await buildExportBatches(db, RANGE)

    expect(result._unsafeUnwrap().built).toBe(0)
    expect(inserted).toEqual([])
  })

  it('races converge on one batch: a conflicting insert builds nothing', async () => {
    const { db, inserted } = fakeDb([[posting()], [line(), line({ direction: 'credit' })]], {
      conflict: true,
    })

    const result = await buildExportBatches(db, RANGE)

    expect(result._unsafeUnwrap().built).toBe(0)
    expect(inserted).toEqual([])
  })

  it('skips a posting dated before the mode cutover, and says how many', async () => {
    readExportSettings.mockResolvedValue({
      mode: 'transaction',
      cutover: '2026-09-15',
      autoSend: {},
      summaryGrain: {},
    })
    const { db, inserted } = fakeDb([[posting()]])

    const result = await buildExportBatches(db, RANGE)

    expect(result._unsafeUnwrap()).toMatchObject({ built: 0, skippedBeforeCutover: 1 })
    expect(inserted).toEqual([])
  })

  it('never batches a posting type with no avenue - a provider entry is theirs', async () => {
    const { db, inserted } = fakeDb([[posting({ postingType: 'provider_sync' })]])

    const result = await buildExportBatches(db, RANGE)

    expect(result._unsafeUnwrap().built).toBe(0)
    expect(inserted).toEqual([])
  })

  it('builds nothing at all with no active book connection', async () => {
    readActiveBookConnection.mockResolvedValue(null)
    const { db } = fakeDb([])

    expect((await buildExportBatches(db, RANGE))._unsafeUnwrap()).toEqual({
      built: 0,
      batchIds: [],
      skippedBeforeCutover: 0,
      connected: false,
    })
  })

  /** A reversal carries its own date, so it joins whichever batch is still open. */
  it('a reversal dated today is an ordinary candidate for today', async () => {
    const { db, inserted } = fakeDb([
      [
        posting({
          id: 'glp_rev',
          docNumber: 'FUL-20260914-R1',
          txnDate: '2026-09-20',
          totalMinor: 5000,
        }),
      ],
      [
        line({ glPostingId: 'glp_rev', direction: 'credit' }),
        line({ glPostingId: 'glp_rev', direction: 'debit' }),
      ],
    ])

    const result = await buildExportBatches(db, RANGE)

    expect(result._unsafeUnwrap().built).toBe(1)
    expect(inserted[0]).toMatchObject({ grainKey: 'glp_rev' })
  })

  it('a receipt already sent as a Payment is never absorbed into its later shipment (91 §8.13)', async () => {
    const { db, inserted, members } = fakeDb([
      [
        posting({ storeId: 'store_1' }),
        posting({ id: 'glp_pay', postingType: 'payment', docNumber: 'PMT-1', batchedId: 'ebp_1' }),
      ],
      [
        line({
          glAccountId: 'acct_ar',
          accountRole: 'accounts_receivable',
          direction: 'debit',
          ...CUSTOMER,
        }),
        line({ glAccountId: 'acct_rev', accountRole: 'revenue_product', direction: 'credit' }),
      ],
    ])

    const result = await buildExportBatches(db, RANGE)

    expect(result._unsafeUnwrap().built).toBe(1)
    expect(inserted[0]).toMatchObject({ objectType: 'invoice', grainKey: 'glp_1' })
    expect(members.map((batch) => batch.map((m) => m.glPostingId))).toEqual([['glp_1']])
  })

  it('a fully paid shipment and its receipt in one run are an Invoice and a Payment applied to it', async () => {
    const { db, inserted, members } = fakeDb([
      [
        posting({ storeId: 'store_1' }),
        posting({ id: 'glp_pay', postingType: 'payment', docNumber: 'PMT-1' }),
      ],
      [{ glPostingId: 'glp_pay', sourceKind: 'order', sourceId: 'order_1' }],
      [{ sourceKind: 'order', sourceId: 'order_1', glPostingId: 'glp_1' }],
      [
        line({
          glAccountId: 'acct_ar',
          accountRole: 'accounts_receivable',
          direction: 'debit',
          ...CUSTOMER,
        }),
        line({ glAccountId: 'acct_rev', accountRole: 'revenue_product', direction: 'credit' }),
        line({
          glPostingId: 'glp_pay',
          glAccountId: 'acct_clearing',
          accountRole: 'clearing',
          direction: 'debit',
        }),
        line({
          glPostingId: 'glp_pay',
          glAccountId: 'acct_ar',
          accountRole: 'accounts_receivable',
          direction: 'credit',
          ...CUSTOMER,
        }),
      ],
    ])

    const result = await buildExportBatches(db, RANGE)

    expect(result._unsafeUnwrap().built).toBe(2)
    const fulfillmentBatch = inserted.find((b) => b.grainKey === 'glp_1')
    const paymentBatch = inserted.find((b) => b.grainKey === 'glp_pay')
    expect(fulfillmentBatch?.objectType).toBe('invoice')
    expect(paymentBatch?.objectType).toBe('payment')
    expect((paymentBatch?.payload as { appliesTo: { glPostingId: string } }).appliesTo).toEqual({
      glPostingId: 'glp_1',
    })
    expect(members.map((batch) => batch.map((m) => m.glPostingId))).toEqual([
      ['glp_1'],
      ['glp_pay'],
    ])
  })

  it('a credit memo becomes a credit_memo', async () => {
    const { db, inserted } = fakeDb([
      [
        posting({
          id: 'glp_crm',
          postingType: 'credit_memo',
          docNumber: 'CRM-1',
          totalMinor: 1000,
        }),
      ],
      [
        line({
          glPostingId: 'glp_crm',
          glAccountId: 'acct_returns',
          accountRole: 'revenue_returns_allowances',
          direction: 'debit',
          amountMinor: 1000,
        }),
        line({
          glPostingId: 'glp_crm',
          glAccountId: 'acct_ar',
          accountRole: 'accounts_receivable',
          direction: 'credit',
          amountMinor: 1000,
          ...CUSTOMER,
        }),
      ],
    ])

    const result = await buildExportBatches(db, RANGE)

    expect(result._unsafeUnwrap().built).toBe(1)
    expect(inserted[0]).toMatchObject({ objectType: 'credit_memo', avenue: 'creditMemo' })
  })

  it('a payout becomes a deposit with the fee line negative', async () => {
    const { db, inserted } = fakeDb([
      [
        posting({
          id: 'glp_po1',
          postingType: 'payout',
          docNumber: 'PAY-1',
          totalMinor: 5000,
        }),
      ],
      [
        line({
          glPostingId: 'glp_po1',
          glAccountId: 'acct_bank',
          accountRole: 'bank',
          direction: 'debit',
          amountMinor: 4700,
        }),
        line({
          glPostingId: 'glp_po1',
          glAccountId: 'acct_fees',
          accountRole: 'payment_processing_fees',
          direction: 'debit',
          amountMinor: 300,
        }),
        line({
          glPostingId: 'glp_po1',
          glAccountId: 'acct_clearing',
          accountRole: 'clearing',
          direction: 'credit',
          amountMinor: 5000,
        }),
      ],
    ])

    const result = await buildExportBatches(db, RANGE)

    expect(result._unsafeUnwrap().built).toBe(1)
    expect(inserted[0]?.objectType).toBe('deposit')
    const payload = inserted[0]?.payload as { lines: Array<{ amountMinor: number }> }
    expect(payload.lines).toEqual(
      expect.arrayContaining([expect.objectContaining({ amountMinor: -300 })])
    )
  })

  it('a vendor bill becomes a bill', async () => {
    const { db, inserted } = fakeDb([
      [
        posting({
          id: 'glp_bil1',
          postingType: 'vendor_bill',
          docNumber: 'BIL-1',
          totalMinor: 600,
        }),
      ],
      [
        line({
          glPostingId: 'glp_bil1',
          glAccountId: 'acct_expense',
          direction: 'debit',
          amountMinor: 600,
        }),
        line({
          glPostingId: 'glp_bil1',
          glAccountId: 'acct_ap',
          accountRole: 'accounts_payable',
          direction: 'credit',
          amountMinor: 600,
          counterpartyType: 'vendor',
          counterpartyId: 'vendor_1',
        }),
      ],
    ])

    const result = await buildExportBatches(db, RANGE)

    expect(result._unsafeUnwrap().built).toBe(1)
    expect(inserted[0]).toMatchObject({ objectType: 'bill', avenue: 'expenseBill' })
  })

  it('a manual journal has no native shape and stays a plain journal, unchanged', async () => {
    const { db, inserted } = fakeDb([
      [
        posting({
          id: 'glp_jnl1',
          postingType: 'manual_journal',
          docNumber: 'JNL-1',
          totalMinor: 100,
        }),
      ],
      [
        line({ glPostingId: 'glp_jnl1', amountMinor: 100 }),
        line({ glPostingId: 'glp_jnl1', direction: 'credit', amountMinor: 100 }),
      ],
    ])

    const result = await buildExportBatches(db, RANGE)

    expect(result._unsafeUnwrap().built).toBe(1)
    expect(inserted[0]?.objectType).toBe('journal')
    expect(h.debug).not.toHaveBeenCalled()
  })

  it('a posting whose lines do not fit its native shape falls back to journal, and logs why', async () => {
    const { db, inserted } = fakeDb([
      [posting({ totalMinor: 5200 })],
      [
        line({
          glAccountId: 'acct_ar',
          accountRole: 'accounts_receivable',
          direction: 'debit',
          ...CUSTOMER,
        }),
        line({ glAccountId: 'acct_unexpected', direction: 'debit', amountMinor: 200 }),
        line({
          glAccountId: 'acct_rev',
          accountRole: 'revenue_product',
          direction: 'credit',
          amountMinor: 5200,
        }),
      ],
    ])

    const result = await buildExportBatches(db, RANGE)

    expect(result._unsafeUnwrap().built).toBe(1)
    expect(inserted[0]?.objectType).toBe('journal')
    expect(h.debug).toHaveBeenCalledWith(
      'Export batch fell back to a journal entry',
      expect.objectContaining({ glPostingId: 'glp_1' })
    )
  })
})

describe('the posting read', () => {
  // A batched row is not a candidate, so nothing downstream selects: every
  // `where` captured here is the reader's own.
  const batched = (n: number, from = 1) =>
    Array.from({ length: n }, (_, i) =>
      posting({ id: `glp_${from + i}`, txnDate: '2026-09-14', batchedId: 'ebp_x' })
    )

  it('pages by keyset to exhaustion: a full page is followed by a read after its last row', async () => {
    const { db, wheres } = fakeDb([batched(5000), batched(12, 5001)])

    const result = await buildExportBatches(db, RANGE)

    expect(result._unsafeUnwrap().built).toBe(0)
    expect(wheres).toHaveLength(2)
    expect(boundValues(wheres[0])).not.toContain('glp_5000')
    expect(boundValues(wheres[1])).toContain('glp_5000')
  })

  it('stops after one short page', async () => {
    const { db, wheres } = fakeDb([batched(4999)])

    await buildExportBatches(db, RANGE)

    expect(wheres).toHaveLength(1)
  })

  it('reads only the named postings when the auto-send path names them', async () => {
    const { db, wheres } = fakeDb([batched(1)])

    await buildExportBatches(db, { ...RANGE, glPostingIds: ['glp_1'] })

    expect(boundValues(wheres[0])).toContain('glp_1')
  })
})

describe('Summary mode', () => {
  const summarySettings = {
    mode: 'summary' as const,
    cutover: null,
    autoSend: {},
    summaryGrain: { fulfillment: 'day' },
  }

  it('builds one batch per summary row, carrying every member posting', async () => {
    readExportSettings.mockResolvedValue(summarySettings)
    readLedgerSummary.mockResolvedValue(
      ok([
        {
          avenue: 'fulfillment',
          grainKey: '2026-09-14',
          storeId: 'store_1',
          railId: null,
          currency: 'USD',
          postingIds: ['glp_1', 'glp_2'],
          txnDateFrom: '2026-09-14',
          txnDateTo: '2026-09-14',
          totalMinor: 9000,
          lines: [
            { glAccountId: 'acct_a', accountCode: '1100', direction: 'debit', amountMinor: 9000 },
            { glAccountId: 'acct_b', accountCode: '4000', direction: 'credit', amountMinor: 9000 },
          ],
        },
      ])
    )
    const { db, inserted } = fakeDb([[posting(), posting({ id: 'glp_2' })]])

    const result = await buildExportBatches(db, RANGE)

    expect(result._unsafeUnwrap().built).toBe(1)
    expect(inserted[0]).toMatchObject({
      mode: 'summary',
      avenue: 'fulfillment',
      grainKey: '2026-09-14',
      storeId: 'store_1',
      objectType: 'journal',
      totalMinor: 9000,
    })
    // The sender resolves the store's placeholder customer from this (91 §8.14).
    expect(inserted[0]?.payload).toMatchObject({ summary: { storeId: 'store_1' } })
  })

  it('excludes an already-batched posting from the summary, so no row sums it twice', async () => {
    readExportSettings.mockResolvedValue(summarySettings)
    const { db } = fakeDb([[posting(), posting({ id: 'glp_2', batchedId: 'ebp_1' })]])

    await buildExportBatches(db, RANGE)

    expect(readLedgerSummary).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ excludePostingIds: ['glp_2'] })
    )
  })

  it('reads the summary from the cutover forward, never before it', async () => {
    readExportSettings.mockResolvedValue({ ...summarySettings, cutover: '2026-09-15' })
    const { db } = fakeDb([[posting({ txnDate: '2026-09-20' })]])

    await buildExportBatches(db, RANGE)

    expect(readLedgerSummary).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ from: '2026-09-15', to: '2026-09-30' })
    )
  })

  it('builds nothing twice: every posting batched means no summary rows to write', async () => {
    readExportSettings.mockResolvedValue(summarySettings)
    const { db, inserted } = fakeDb([[posting({ batchedId: 'ebp_1' })]])

    const result = await buildExportBatches(db, RANGE)

    expect(result._unsafeUnwrap().built).toBe(0)
    expect(inserted).toEqual([])
    expect(readLedgerSummary).not.toHaveBeenCalled()
  })
})
