// packages/lib/src/postings/export/__tests__/build-batches.test.ts
//
// The build's two properties: it is IDEMPOTENT in both modes - a second run
// over a range that already has its batches writes nothing - and it never
// touches a posting dated before the cutover. A fake db in `post-entry.test.ts`'s
// style: what is exercised is the builder's own selection, not Postgres.

import type { Database } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const readActiveBookConnection = vi.fn()
vi.mock('../../book-connections', () => ({
  readActiveBookConnection: (...a: unknown[]) => readActiveBookConnection(...a),
}))

const readExportSettings = vi.fn()
vi.mock('../../export-settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../export-settings')>()),
  readExportSettings: (...a: unknown[]) => readExportSettings(...a),
}))

const readLedgerSummary = vi.fn()
vi.mock('../../reads/ledger-summary', () => ({
  readLedgerSummary: (...a: unknown[]) => readLedgerSummary(...a),
}))

import { ok } from 'neverthrow'
import { buildExportBatches } from '../build-batches'

const ORG = 'org_1'
const CONNECTION = { connectionId: 'conn_1', bookId: 'book_1', exportFromDate: '2026-01-01' }

function posting(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'glp_1',
    postingType: 'fulfillment',
    txnDate: '2026-09-14',
    docNumber: 'AUXX-FUL-20260914',
    currency: 'USD',
    storeId: null,
    railId: null,
    totalMinor: 5000,
    built: {},
    batchedId: null,
    ...over,
  }
}

function line(over: Partial<Record<string, unknown>> = {}) {
  return {
    glPostingId: 'glp_1',
    glAccountId: 'acct_a',
    accountCode: '1100',
    accountName: 'A/R',
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
 * `inserted` carries only the batches an insert actually returned a row for,
 * which is what `onConflictDoNothing` decides in production.
 */
function fakeDb(selects: unknown[][], options: { conflict?: boolean } = {}) {
  let call = 0
  const inserted: Array<Record<string, unknown>> = []
  const selectChain: Record<string, unknown> = {}
  const passthrough = () => selectChain
  for (const method of ['from', 'leftJoin', 'where', 'orderBy', 'limit'])
    selectChain[method] = passthrough
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
        if (!Array.isArray(values)) pending = values
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
  return { db, inserted }
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
  it('builds one batch per posted, un-batched posting', async () => {
    const { db, inserted } = fakeDb([[posting()], [line(), line({ direction: 'credit' })]])

    const result = await buildExportBatches(db, RANGE)

    expect(result._unsafeUnwrap().built).toBe(1)
    expect(inserted[0]).toMatchObject({
      mode: 'transaction',
      avenue: 'fulfillment',
      // The posting id IS the grain: one posting, one batch.
      grainKey: 'glp_1',
      state: 'ready',
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
          docNumber: 'AUXX-FUL-20260914-R1',
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
      totalMinor: 9000,
    })
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
