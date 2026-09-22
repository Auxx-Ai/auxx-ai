// packages/lib/src/accounting/export/__tests__/summary-rows.test.ts
//
// 95 §3.2: every row of the status table, derived from one SQL row plus its
// hydrated batch.

import type { Database } from '@auxx/database'
import { sql } from 'drizzle-orm'
import { ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const summaryScope = vi.fn()
vi.mock('../summary-ctes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../summary-ctes')>()),
  summaryScope: (...a: unknown[]) => summaryScope(...a),
  bucketCtes: () => sql`WITH member AS (SELECT 1)`,
}))

const listExportBatches = vi.fn()
vi.mock('../queue-reads', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../queue-reads')>()),
  listExportBatches: (...a: unknown[]) => listExportBatches(...a),
}))

import { type SummaryRowStatus, summaryRowStatus } from '../client'
import { countSummaryRows, listSummaryRows } from '../summary-rows'

const ORG = 'org_1'

function raw(grainKey: string, batchState: string | null, newCount: number, memberCount = 3) {
  return {
    avenue: 'fulfillment',
    grainKey,
    storeId: 'store_1',
    railId: '',
    currency: 'USD',
    totalMinor: '4500',
    txnDateFrom: grainKey,
    txnDateTo: grainKey,
    memberCount,
    newCount,
    firstPostingId: `p_${grainKey}`,
    dayKey: grainKey,
    batchId: batchState ? `b_${grainKey}` : null,
    batchState,
    total: 7,
  }
}

/** `db.execute` resolves to the next canned result set. */
function fakeDb(results: unknown[][]): Database & { execute: ReturnType<typeof vi.fn> } {
  let call = 0
  const execute = vi.fn(async () => ({ rows: results[call++] ?? [] }))
  return { execute } as unknown as Database & { execute: ReturnType<typeof vi.fn> }
}

beforeEach(() => {
  vi.clearAllMocks()
  summaryScope.mockResolvedValue({
    from: '2026-01-01',
    to: '2026-09-23',
    bookId: 'book_1',
    settings: {},
  })
  listExportBatches.mockImplementation(async (_db, input: { batchIds: string[] }) =>
    ok(input.batchIds.map((id) => ({ id, state: 'ready' })))
  )
})

describe('listSummaryRows status', () => {
  const table: Array<[string | null, number, SummaryRowStatus]> = [
    [null, 3, 'not_sent'],
    ['ready', 0, 'ready'],
    ['ready', 2, 'ready_new'],
    ['sending', 0, 'sending'],
    ['sending', 2, 'sending'],
    ['sent', 0, 'sent'],
    ['sent', 2, 'sent_new'],
    ['failed', 0, 'failed'],
    ['failed', 2, 'failed'],
  ]

  it('derives every row of the 95 §3.2 table', async () => {
    const rows = table.map(([state, newCount], index) =>
      raw(`2026-02-${String(index + 10)}`, state, newCount)
    )
    const db = fakeDb([rows])
    const result = await listSummaryRows(db, { organizationId: ORG, tab: 'ready', limit: 50 })
    const { items, total } = result._unsafeUnwrap()

    expect(items.map((item) => item.status)).toEqual(table.map(([, , status]) => status))
    expect(total).toBe(7)
    expect(items[0]).toMatchObject({
      key: 'fulfillment 2026-02-10 store_1  USD',
      storeId: 'store_1',
      railId: null,
      totalMinor: 4500,
      newCount: 3,
      memberCount: 3,
      batch: null,
    })
    // Hydrated by id, one read, only the rows that have a batch.
    expect(listExportBatches).toHaveBeenCalledTimes(1)
    expect(listExportBatches.mock.calls[0]?.[1]).toMatchObject({
      organizationId: ORG,
      batchIds: rows.slice(1).map((row) => row.batchId),
      limit: rows.length - 1,
    })
    expect(items[1]?.batch?.id).toBe('b_2026-02-11')
    expect(db.execute).toHaveBeenCalledTimes(1)
  })

  it('is empty without a summary scope, and reads nothing', async () => {
    summaryScope.mockResolvedValue(null)
    const db = fakeDb([])
    const result = await listSummaryRows(db, { organizationId: ORG, tab: 'sent', limit: 50 })
    expect(result._unsafeUnwrap()).toEqual({ items: [], total: 0 })
    expect(db.execute).not.toHaveBeenCalled()
  })

  it('counts separately when a page past the end comes back empty', async () => {
    const db = fakeDb([[], [{ total: 4 }]])
    const result = await listSummaryRows(db, {
      organizationId: ORG,
      tab: 'failed',
      limit: 50,
      offset: 50,
    })
    expect(result._unsafeUnwrap()).toEqual({ items: [], total: 4 })
    expect(listExportBatches).not.toHaveBeenCalled()
  })

  it('returns the error rather than throwing', async () => {
    const db = { execute: vi.fn().mockRejectedValue(new Error('boom')) } as unknown as Database
    const result = await listSummaryRows(db, { organizationId: ORG, tab: 'ready', limit: 50 })
    expect(result._unsafeUnwrapErr().message).toBe('boom')
  })
})

describe('countSummaryRows', () => {
  it('fills every tab, zero when absent', async () => {
    const db = fakeDb([
      [
        { tab: 'ready', total: 5 },
        { tab: 'failed', total: 2 },
      ],
    ])
    const result = await countSummaryRows(db, { organizationId: ORG })
    expect(result._unsafeUnwrap()).toEqual({ ready: 5, sent: 0, failed: 2 })
  })

  it('is all zero without a summary scope', async () => {
    summaryScope.mockResolvedValue(null)
    const result = await countSummaryRows(fakeDb([]), { organizationId: ORG })
    expect(result._unsafeUnwrap()).toEqual({ ready: 0, sent: 0, failed: 0 })
  })
})

describe('summaryRowStatus', () => {
  it('reads a withdrawn batch as not sent', () => {
    expect(summaryRowStatus('withdrawn', 0)).toBe('not_sent')
  })
})
