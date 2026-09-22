// packages/lib/src/accounting/export/__tests__/release.test.ts
//
// Gate 2's verb, and 89 D8's guard on it: a batch the mapping table already
// refuses is not put on the queue, and the bulk bar is told which ones.

import type { Database } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const readExportBatchBlockers = vi.fn()
vi.mock('../preflight', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../preflight')>()),
  readExportBatchBlockers: (...a: unknown[]) => readExportBatchBlockers(...a),
}))

const add = vi.fn(async (_args: unknown[]) => undefined)
vi.mock('../../../jobs/queues', () => ({
  Queues: { exportBatchQueue: 'export-batch' },
  getQueue: () => ({ add: (...a: unknown[]) => add(a) }),
}))

import { PgDialect } from 'drizzle-orm/pg-core'
import { ok } from 'neverthrow'
import { releaseExportBatches, releaseFailedBatchesNamingAccount } from '../release'

const ORG = 'org_1'

const ITEMS = [
  {
    key: 'unmapped_account' as const,
    ref: 'gl_b',
    label: '5010 COGS - Direct Labor',
    remedy: 'Pick its account under Accounting > Settings > Accounts > Chart of accounts.',
  },
]

/** The last `where` the fake was handed, so a test can read the SQL it built. */
const captured: { where?: unknown } = {}

function fakeDb(rows: Array<Record<string, unknown>>): Database {
  const chain: Record<string, unknown> = {}
  chain.from = () => chain
  // biome-ignore lint/suspicious/noThenProperty: the fake must be awaitable
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(rows).then(resolve)
  chain.where = (where: unknown) => {
    captured.where = where
    return chain
  }
  return { select: () => chain } as unknown as Database
}

beforeEach(() => {
  vi.clearAllMocks()
  readExportBatchBlockers.mockResolvedValue(ok(new Map()))
})

describe('releaseExportBatches', () => {
  it('releases what is ready and skips what has nothing to release', async () => {
    const db = fakeDb([
      { id: 'b1', state: 'ready', payload: {} },
      { id: 'b2', state: 'sent', payload: {} },
    ])

    const result = await releaseExportBatches(db, { organizationId: ORG, batchIds: ['b1', 'b2'] })

    expect(result._unsafeUnwrap()).toEqual({ released: ['b1'], skipped: ['b2'], blocked: [] })
    expect(add).toHaveBeenCalledTimes(1)
  })

  it('does not enqueue a blocked batch, and hands it back with its items', async () => {
    readExportBatchBlockers.mockResolvedValue(ok(new Map([['b1', ITEMS]])))
    const db = fakeDb([
      { id: 'b1', state: 'ready', payload: {} },
      { id: 'b2', state: 'failed', payload: {} },
    ])

    const result = await releaseExportBatches(db, { organizationId: ORG, batchIds: ['b1', 'b2'] })

    expect(result._unsafeUnwrap()).toEqual({
      released: ['b2'],
      skipped: [],
      blocked: [{ batchId: 'b1', items: ITEMS }],
    })
    expect(add).toHaveBeenCalledTimes(1)
  })

  it('asks the mapping table about the releasable rows alone', async () => {
    const db = fakeDb([
      { id: 'b1', state: 'ready', payload: { docNumber: 'A' } },
      { id: 'b2', state: 'withdrawn', payload: { docNumber: 'B' } },
    ])

    await releaseExportBatches(db, { organizationId: ORG, batchIds: ['b1', 'b2'] })

    expect(readExportBatchBlockers).toHaveBeenCalledWith(db, ORG, [
      { id: 'b1', state: 'ready', payload: { docNumber: 'A' } },
    ])
  })
})

describe('releaseFailedBatchesNamingAccount', () => {
  it('enqueues a batch whose every account is mapped now', async () => {
    const db = fakeDb([{ id: 'b1', payload: {} }])

    const result = await releaseFailedBatchesNamingAccount(db, {
      organizationId: ORG,
      glAccountId: 'gl_a',
    })

    expect(result._unsafeUnwrap()).toEqual({ released: ['b1'], stillBlocked: [] })
    expect(add).toHaveBeenCalledTimes(1)
  })

  it('leaves a batch that still names another unmapped account alone', async () => {
    readExportBatchBlockers.mockResolvedValue(ok(new Map([['b1', ITEMS]])))
    const db = fakeDb([{ id: 'b1', payload: {} }])

    const result = await releaseFailedBatchesNamingAccount(db, {
      organizationId: ORG,
      glAccountId: 'gl_a',
    })

    expect(result._unsafeUnwrap()).toEqual({ released: [], stillBlocked: ['b1'] })
    expect(add).not.toHaveBeenCalled()
  })

  // A `data` failure naming the account is never fetched, so it is never
  // enqueued: the only re-releasable refusal is a configuration one.
  it('selects failed configuration rows that name the account, and nothing else', async () => {
    const db = fakeDb([])

    await releaseFailedBatchesNamingAccount(db, { organizationId: ORG, glAccountId: 'gl_a' })

    const query = new PgDialect().sqlToQuery(captured.where as never)
    expect(query.sql).toContain('@> $4::jsonb')
    expect(query.params).toEqual([ORG, 'failed', 'configuration', '[{"ref":"gl_a"}]'])
  })
})
