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

import type { Database } from '@auxx/database'
import { err, ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isSummaryBucketComplete, sweepExportBatches, sweepSummaryBuckets } from '../sweep'

const h = vi.hoisted(() => ({
  settings: vi.fn(),
  orgSettings: vi.fn(),
  listSummaryRows: vi.fn(),
  sendSummaryBucket: vi.fn(),
}))

vi.mock('../../ledger/setup/read-export-settings', () => ({ readExportSettings: h.settings }))
vi.mock('../../../settings/read', () => ({ readOrganizationSettings: h.orgSettings }))
vi.mock('../summary-rows', () => ({ listSummaryRows: h.listSummaryRows }))
vi.mock('../send-bucket', () => ({ sendSummaryBucket: h.sendSummaryBucket }))

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
