// packages/lib/src/accounting/export/__tests__/sweep.test.ts
//
// The sweep orders due batches by `txnDate, createdAt` (plan 67 §5.2), so a
// Payment's invoice is normally picked up in the same or an earlier pass than
// the Payment that applies to it. A fake db that returns no rows is enough -
// what is exercised is the `orderBy` call the query builds, not Postgres's
// own sort.
//
// 🛑 Only the FIRST sort key is asserted by content. The global `@auxx/database`
// mock (`src/test/setup.ts`) hands every column back as `{}`, so a column
// reference used as a bare VALUE (`asc(schema.ExportBatch.createdAt)`) has
// nothing distinguishing left on it under this mock - "column-level refs
// remain unassertable", the setup file's own words. The first key survives
// because it is a `sql` template: the LITERAL text around the interpolation
// (`->>'txnDate'`) is static and renders regardless of what the column
// resolves to.

import { type Database, schema } from '@auxx/database'
import { err, ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isSummaryBucketComplete,
  sweepExportBatches,
  sweepSummaryBuckets,
  sweepTransactionPostings,
} from '../sweep'

const h = vi.hoisted(() => ({
  settings: vi.fn(),
  orgSettings: vi.fn(),
  listSummaryRows: vi.fn(),
  sendSummaryBucket: vi.fn(),
  connection: vi.fn(),
  build: vi.fn(),
  send: vi.fn(),
}))

vi.mock('../../ledger/setup/read-export-settings', () => ({ readExportSettings: h.settings }))
vi.mock('../../../settings/read', () => ({ readOrganizationSettings: h.orgSettings }))
vi.mock('../summary-rows', () => ({ listSummaryRows: h.listSummaryRows }))
vi.mock('../send-bucket', () => ({ sendSummaryBucket: h.sendSummaryBucket }))
vi.mock('../../providers/book-connections', () => ({ readActiveBookConnection: h.connection }))
vi.mock('../build-batches', () => ({ buildExportBatches: h.build }))
vi.mock('../send', () => ({ MAX_AUTO_ATTEMPTS: 5, sendExportBatch: h.send }))

const TODAY = '2026-09-22'

function exportSettings(
  mode: 'summary' | 'transaction',
  autoSend: Record<string, boolean> = { receipt: true }
) {
  return { mode, cutover: null, autoSend, summaryGrain: {} }
}

function bucket(grainKey: string, overrides: Record<string, unknown> = {}) {
  return {
    key: `receipt ${grainKey} USD`,
    avenue: 'receipt',
    grainKey,
    storeId: null,
    railId: null,
    currency: 'USD',
    dayKey: grainKey,
    status: 'not_sent',
    batch: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(`${TODAY}T12:00:00Z`))
  h.settings.mockReset().mockResolvedValue(exportSettings('transaction'))
  h.orgSettings.mockReset().mockResolvedValue({ 'accounting.bookTimeZone': 'UTC' })
  h.listSummaryRows.mockReset().mockResolvedValue(ok({ items: [], total: 0 }))
  h.sendSummaryBucket
    .mockReset()
    .mockImplementation(async (_db: unknown, input: { key: { grainKey: string } }) =>
      ok({ batchId: `b_${input.key.grainKey}`, status: 'sent', attempts: 1, built: true })
    )
  h.connection.mockReset().mockResolvedValue(null)
  h.build.mockReset()
  h.send
    .mockReset()
    .mockImplementation(async (_db: unknown, input: { batchId: string }) =>
      ok({ batchId: input.batchId, status: 'sent', attempts: 1 })
    )
})

/** Walk a Drizzle SQL fragment and collect every string chunk it renders. */
function sqlText(node: unknown): string {
  const out: string[] = []
  const visit = (value: unknown): void => {
    if (value == null) return
    if (Array.isArray(value)) {
      for (const child of value) visit(child)
      return
    }
    if (typeof value === 'string') {
      out.push(value)
      return
    }
    if (typeof value === 'object') {
      const record = value as Record<string, unknown>
      if ('queryChunks' in record) visit(record.queryChunks)
      else if ('value' in record) visit(record.value)
    }
  }
  visit(node)
  return out.join(' ')
}

function fakeDb(): { db: Database; orderArgs: unknown[]; whereArg: unknown } {
  const captured: { args: unknown[]; where: unknown } = { args: [], where: null }
  const chain: Record<string, unknown> = {}
  for (const method of ['from', 'limit']) chain[method] = () => chain
  chain.where = (arg: unknown) => {
    captured.where = arg
    return chain
  }
  chain.orderBy = (...args: unknown[]) => {
    captured.args = args
    return chain
  }
  // biome-ignore lint/suspicious/noThenProperty: the fake must be awaitable
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve([]).then(resolve)
  return {
    db: { select: () => chain } as unknown as Database,
    get orderArgs() {
      return captured.args
    },
    get whereArg() {
      return captured.where
    },
  } as unknown as { db: Database; orderArgs: unknown[]; whereArg: unknown }
}

describe('sweepExportBatches - due-batch order', () => {
  it('orders by the payload txnDate first, then a second sort key', async () => {
    const fake = fakeDb()

    await sweepExportBatches(fake.db, { organizationId: 'org_1' })

    expect(fake.orderArgs).toHaveLength(2)
    expect(sqlText(fake.orderArgs[0])).toContain("txnDate')")
    expect(sqlText(fake.orderArgs[0])).toContain('ASC')
    // The second key exists and is a distinct expression from the first -
    // that it names `createdAt` is asserted by reading `sweep.ts` itself.
    expect(fake.orderArgs[1]).not.toBe(fake.orderArgs[0])
    expect(fake.orderArgs[1]).toBeTruthy()
  })
})

// 89 D3. `fail()` writes no `nextAttemptAt` for `configuration` or `data`, and
// this is the other half of that contract: the failed branch is gated on a
// `<=` against now, which a NULL never satisfies. No query change was needed,
// so this test exists to stop one being made.
describe('sweepExportBatches - which failures are due', () => {
  it('admits a failed batch only through a nextAttemptAt comparison', async () => {
    const fake = fakeDb()

    await sweepExportBatches(fake.db, { organizationId: 'org_1' })

    const where = sqlText(fake.whereArg)
    expect(where).toContain('failed')
    expect(where).toContain('<=')
    expect(where).toContain('<')
  })
})

const db = {} as Database
const sentKeys = () =>
  h.sendSummaryBucket.mock.calls.map(
    ([, input]) => (input as { key: { grainKey: string } }).key.grainKey
  )

describe('isSummaryBucketComplete - 95 D1', () => {
  it('builds a day more than two days back, not one two days back or younger', () => {
    expect(isSummaryBucketComplete('2026-09-19', TODAY)).toBe(true)
    expect(isSummaryBucketComplete('2026-09-20', TODAY)).toBe(false)
    expect(isSummaryBucketComplete('2026-09-22', TODAY)).toBe(false)
    expect(isSummaryBucketComplete('2026-08-31', '2026-09-03')).toBe(true)
  })

  it('builds a month only from the 1st of the next', () => {
    expect(isSummaryBucketComplete('2026-09', '2026-09-30')).toBe(false)
    expect(isSummaryBucketComplete('2026-09', '2026-10-01')).toBe(true)
    expect(isSummaryBucketComplete('2025-12', '2026-01-01')).toBe(true)
  })

  it('treats a grain-less bucket as complete at once', () => {
    expect(isSummaryBucketComplete('post_1', TODAY)).toBe(true)
  })

  it('closes a payout bucket by the day rule on its latest posting', () => {
    expect(isSummaryBucketComplete('po_1', TODAY, '2026-09-19')).toBe(true)
    expect(isSummaryBucketComplete('po_1', TODAY, '2026-09-20')).toBe(false)
  })
})

describe('sweepSummaryBuckets - the build rule', () => {
  beforeEach(() => {
    h.settings.mockResolvedValue(exportSettings('summary'))
  })

  it('sends a complete day bucket and skips a young one', async () => {
    h.listSummaryRows.mockResolvedValue(
      ok({ items: [bucket('2026-09-18'), bucket('2026-09-21')], total: 2 })
    )

    const results = await sweepSummaryBuckets(db, { organizationId: 'org_1' })

    expect(sentKeys()).toEqual(['2026-09-18'])
    expect(results).toHaveLength(1)
    expect(h.listSummaryRows).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ tab: 'ready', categories: ['receipt'], direction: 'asc' })
    )
  })

  it('judges "today" in the book timezone', async () => {
    // 2026-09-22T12:00Z is already 2026-09-23 in Auckland, so the 20th is complete there.
    h.orgSettings.mockResolvedValue({ 'accounting.bookTimeZone': 'Pacific/Auckland' })
    h.listSummaryRows.mockResolvedValue(ok({ items: [bucket('2026-09-20')], total: 1 }))

    await sweepSummaryBuckets(db, { organizationId: 'org_1' })

    expect(sentKeys()).toEqual(['2026-09-20'])
  })

  it('sends a month bucket only once the next month has begun', async () => {
    h.listSummaryRows.mockResolvedValue(
      ok({ items: [bucket('2026-08'), bucket('2026-09')], total: 2 })
    )

    await sweepSummaryBuckets(db, { organizationId: 'org_1' })

    expect(sentKeys()).toEqual(['2026-08'])
  })

  it('never touches a bucket that already has a batch', async () => {
    h.listSummaryRows.mockResolvedValue(
      ok({
        items: [
          bucket('2026-09-01', { status: 'ready', batch: { id: 'b_1' } }),
          bucket('2026-09-02', { status: 'sending', batch: { id: 'b_2' } }),
        ],
        total: 2,
      })
    )

    await sweepSummaryBuckets(db, { organizationId: 'org_1' })

    expect(h.sendSummaryBucket).not.toHaveBeenCalled()
  })

  it('does nothing when no avenue auto-sends', async () => {
    h.settings.mockResolvedValue(exportSettings('summary', { receipt: false }))

    expect(await sweepSummaryBuckets(db, { organizationId: 'org_1' })).toEqual([])
    expect(h.listSummaryRows).not.toHaveBeenCalled()
  })

  it('does nothing outside summary mode', async () => {
    h.settings.mockResolvedValue(exportSettings('transaction'))

    expect(await sweepSummaryBuckets(db, { organizationId: 'org_1' })).toEqual([])
    expect(h.listSummaryRows).not.toHaveBeenCalled()
  })

  it('keeps going after one bucket fails', async () => {
    h.listSummaryRows.mockResolvedValue(
      ok({ items: [bucket('2026-09-01'), bucket('2026-09-02'), bucket('2026-09-03')], total: 3 })
    )
    h.sendSummaryBucket.mockResolvedValueOnce(err(new Error('nets to one account')))

    const results = await sweepSummaryBuckets(db, { organizationId: 'org_1' })

    expect(sentKeys()).toEqual(['2026-09-01', '2026-09-02', '2026-09-03'])
    expect(results.map((r) => r.batchId)).toEqual(['b_2026-09-02', 'b_2026-09-03'])
  })

  it('stops at the cap', async () => {
    const items = Array.from({ length: 60 }, (_, i) =>
      bucket(`2026-07-${String((i % 28) + 1).padStart(2, '0')}`, { key: `k${i}` })
    )
    h.listSummaryRows.mockResolvedValue(ok({ items, total: items.length }))

    await sweepSummaryBuckets(db, { organizationId: 'org_1' })

    expect(h.sendSummaryBucket).toHaveBeenCalledTimes(50)
  })

  it('runs from sweepExportBatches for one org', async () => {
    h.listSummaryRows.mockResolvedValue(ok({ items: [bucket('2026-09-01')], total: 1 }))
    const fake = fakeDb()

    const swept = await sweepExportBatches(fake.db, { organizationId: 'org_1' })

    expect(sentKeys()).toEqual(['2026-09-01'])
    expect(swept.examined).toBe(1)
  })
})

interface Candidate {
  id: string
  txnDate: string
}
interface DueBatch {
  id: string
  organizationId: string
  avenue: string
  state: 'ready' | 'failed'
}

/** A db whose reads answer by table: unbatched postings, then the batches due to send. */
function routedDb(store: { postings: Candidate[]; batches: DueBatch[] }) {
  const reads: Array<{ table: unknown; where: unknown; limit?: number }> = []
  const db = {
    select: () => {
      const read: { table: unknown; where: unknown; limit?: number } = { table: null, where: null }
      reads.push(read)
      const chain: Record<string, unknown> = {
        from: (table: unknown) => {
          read.table = table
          return chain
        },
        where: (arg: unknown) => {
          read.where = arg
          return chain
        },
        orderBy: () => chain,
        limit: (n: number) => {
          read.limit = n
          return chain
        },
      }
      // biome-ignore lint/suspicious/noThenProperty: the fake must be awaitable
      chain.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve(
          read.table === schema.GlPosting
            ? store.postings.slice(0, read.limit)
            : read.table === schema.ExportBatch
              ? store.batches
              : []
        ).then(resolve)
      return chain
    },
  } as unknown as Database
  return { db, reads, postingReads: () => reads.filter((r) => r.table === schema.GlPosting) }
}

/** The builder's contract: one `ready` batch per named posting, which the send half then finds. */
function buildInto(store: { batches: DueBatch[] }, avenue = 'receipt') {
  h.build.mockImplementation(async (_db: unknown, input: { glPostingIds: string[] }) => {
    const batchIds = input.glPostingIds.map((id) => `b_${id}`)
    for (const id of batchIds)
      store.batches.push({ id, organizationId: 'org_1', avenue, state: 'ready' })
    return ok({ built: batchIds.length, batchIds, skippedBeforeCutover: 0, connected: true })
  })
}

describe('sweepTransactionPostings - the build half (101 E5)', () => {
  beforeEach(() => {
    h.connection.mockResolvedValue({ id: 'conn_1', exportFromDate: '2026-01-01' })
  })

  it('builds a posting held while autoSend was off, and sends it in the same pass once on', async () => {
    const store = { postings: [{ id: 'p_1', txnDate: '2026-09-01' }], batches: [] as DueBatch[] }
    buildInto(store)
    h.settings.mockResolvedValue(exportSettings('transaction', { receipt: false }))

    await sweepExportBatches(routedDb(store).db, { organizationId: 'org_1' })
    expect(h.build).not.toHaveBeenCalled()
    expect(h.send).not.toHaveBeenCalled()

    h.settings.mockResolvedValue(exportSettings('transaction', { receipt: true }))
    const swept = await sweepExportBatches(routedDb(store).db, { organizationId: 'org_1' })

    expect(h.build).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'org_1',
      from: '2026-09-01',
      to: '2026-09-01',
      glPostingIds: ['p_1'],
    })
    expect(h.send).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'org_1',
      batchId: 'b_p_1',
    })
    expect(swept.results.map((r) => r.batchId)).toEqual(['b_p_1'])
  })

  it('after summary -> transaction, builds an unsent bucket one batch per posting', async () => {
    const postings = [
      { id: 'p_1', txnDate: '2026-09-20' },
      { id: 'p_2', txnDate: '2026-09-21' },
      { id: 'p_3', txnDate: '2026-09-21' },
    ]
    const store = { postings, batches: [] as DueBatch[] }
    buildInto(store)

    h.settings.mockResolvedValue(exportSettings('summary'))
    expect(await sweepTransactionPostings(routedDb(store).db, { organizationId: 'org_1' })).toEqual(
      []
    )
    expect(h.build).not.toHaveBeenCalled()

    h.settings.mockResolvedValue(exportSettings('transaction'))
    const built = await sweepTransactionPostings(routedDb(store).db, { organizationId: 'org_1' })

    expect(built).toEqual(['b_p_1', 'b_p_2', 'b_p_3'])
    expect(h.build).toHaveBeenCalledTimes(1)
    expect(h.build.mock.calls[0]![1]).toMatchObject({
      from: '2026-09-20',
      to: '2026-09-21',
      glPostingIds: ['p_1', 'p_2', 'p_3'],
    })
  })

  it('reads only autoSend avenues, and never sends a held batch', async () => {
    h.settings.mockResolvedValue(
      exportSettings('transaction', { receipt: false, fulfillment: true })
    )
    const store = {
      postings: [] as Candidate[],
      batches: [
        { id: 'b_held', organizationId: 'org_1', avenue: 'receipt', state: 'ready' as const },
      ],
    }
    const fake = routedDb(store)

    await sweepExportBatches(fake.db, { organizationId: 'org_1' })

    const candidateWhere = sqlText(fake.postingReads()[0]!.where)
    expect(candidateWhere).toContain('fulfillment')
    expect(candidateWhere).not.toContain('receipt')
    const dueWhere = sqlText(fake.reads.find((r) => r.table === schema.ExportBatch)!.where)
    expect(dueWhere).toContain('fulfillment')
    expect(dueWhere).not.toContain('receipt')
    expect(h.send).not.toHaveBeenCalled()
  })

  it('builds nothing when no avenue auto-sends', async () => {
    h.settings.mockResolvedValue(exportSettings('transaction', { receipt: false }))
    const fake = routedDb({ postings: [{ id: 'p_1', txnDate: '2026-09-01' }], batches: [] })

    expect(await sweepTransactionPostings(fake.db, { organizationId: 'org_1' })).toEqual([])
    expect(fake.postingReads()).toHaveLength(0)
  })

  it('builds nothing without an active book connection', async () => {
    h.connection.mockResolvedValue(null)
    const fake = routedDb({ postings: [{ id: 'p_1', txnDate: '2026-09-01' }], batches: [] })

    expect(await sweepTransactionPostings(fake.db, { organizationId: 'org_1' })).toEqual([])
    expect(h.build).not.toHaveBeenCalled()
  })

  it('reads at or after the floor, max(Export from, exportFromDate)', async () => {
    h.settings.mockResolvedValue({ ...exportSettings('transaction'), cutover: '2026-06-01' })
    const fake = routedDb({ postings: [], batches: [] })

    await sweepTransactionPostings(fake.db, { organizationId: 'org_1' })

    expect(sqlText(fake.postingReads()[0]!.where)).toContain('2026-06-01')
  })

  it('is bounded per pass', async () => {
    const postings = Array.from({ length: 80 }, (_, i) => ({
      id: `p_${i}`,
      txnDate: '2026-09-01',
    }))
    const store = { postings, batches: [] as DueBatch[] }
    buildInto(store)
    const fake = routedDb(store)

    await sweepTransactionPostings(fake.db, { organizationId: 'org_1' })

    expect(fake.postingReads()[0]!.limit).toBe(50)
    expect((h.build.mock.calls[0]![1] as { glPostingIds: string[] }).glPostingIds).toHaveLength(50)
  })

  it('builds one at a time when the page fails, so one bad posting holds back nothing', async () => {
    const store = {
      postings: [
        { id: 'p_bad', txnDate: '2026-09-01' },
        { id: 'p_ok', txnDate: '2026-09-02' },
      ],
      batches: [] as DueBatch[],
    }
    h.build.mockImplementation(async (_db: unknown, input: { glPostingIds: string[] }) =>
      input.glPostingIds.includes('p_bad')
        ? err(new Error('unshapeable'))
        : ok({
            built: 1,
            batchIds: input.glPostingIds.map((id) => `b_${id}`),
            skippedBeforeCutover: 0,
            connected: true,
          })
    )

    const built = await sweepTransactionPostings(routedDb(store).db, { organizationId: 'org_1' })

    expect(built).toEqual(['b_p_ok'])
    expect(h.build).toHaveBeenCalledTimes(3)
  })
})
