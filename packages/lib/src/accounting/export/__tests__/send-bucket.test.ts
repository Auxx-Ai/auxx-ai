// packages/lib/src/accounting/export/__tests__/send-bucket.test.ts
//
// 95 §3.2 actions: Send builds when the bucket has no live batch, sends or
// retries the one it has, and Rebuild is rollback + build + send.

import type { Database } from '@auxx/database'
import { ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const summaryScope = vi.fn()
vi.mock('../summary-ctes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../summary-ctes')>()),
  summaryScope: (...a: unknown[]) => summaryScope(...a),
}))
const readUnbuiltSummaryMembers = vi.fn()
vi.mock('../unbuilt-summary', () => ({
  readUnbuiltSummaryMembers: (...a: unknown[]) => readUnbuiltSummaryMembers(...a),
}))
const buildExportBatches = vi.fn()
vi.mock('../build-batches', () => ({
  buildExportBatches: (...a: unknown[]) => buildExportBatches(...a),
}))
const sendExportBatch = vi.fn()
vi.mock('../send', () => ({ sendExportBatch: (...a: unknown[]) => sendExportBatch(...a) }))
const rollbackExportBatch = vi.fn()
vi.mock('../rollback', () => ({
  rollbackExportBatch: (...a: unknown[]) => rollbackExportBatch(...a),
}))

import { rebuildSummaryBucket, sendSummaryBucket } from '../send-bucket'

const ORG = 'org_1'
const KEY = {
  avenue: 'fulfillment' as const,
  grainKey: '2026-02',
  storeId: null,
  railId: null,
  currency: 'USD',
}

/** Resolves each awaited `select()` chain (the live-batch lookup) to the next canned result set. */
function fakeDb(results: unknown[][]): Database {
  let call = 0
  const chain: Record<string, unknown> = {}
  for (const key of ['from', 'where', 'limit']) chain[key] = () => chain
  // biome-ignore lint/suspicious/noThenProperty: the fake must be awaitable
  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(results[call++] ?? []).then(resolve)
  return { select: () => chain } as unknown as Database
}

beforeEach(() => {
  vi.clearAllMocks()
  summaryScope.mockResolvedValue({ from: '2026-01-01', to: '2026-09-23', bookId: 'book_1' })
  sendExportBatch.mockImplementation(async (_db, input: { batchId: string }) =>
    ok({ batchId: input.batchId, status: 'sent', attempts: 1 })
  )
})

describe('sendSummaryBucket', () => {
  it('builds the one bucket over its own dates, then sends what it built', async () => {
    readUnbuiltSummaryMembers.mockResolvedValue(
      ok([{ txnDate: '2026-02-17' }, { txnDate: '2026-02-03' }])
    )
    buildExportBatches.mockResolvedValue(ok({ batchIds: ['b_new'] }))
    const db = fakeDb([[], [{ id: 'b_new', state: 'ready' }]])

    const result = await sendSummaryBucket(db, { organizationId: ORG, key: KEY })

    expect(buildExportBatches.mock.calls[0]?.[1]).toEqual({
      organizationId: ORG,
      from: '2026-02-03',
      to: '2026-02-17',
      group: KEY,
    })
    expect(sendExportBatch.mock.calls[0]?.[1]).toMatchObject({ batchId: 'b_new', manual: false })
    expect(result._unsafeUnwrap()).toMatchObject({ batchId: 'b_new', built: true, status: 'sent' })
  })

  it('sends a ready batch without building', async () => {
    const db = fakeDb([[{ id: 'b_1', state: 'ready' }]])
    const result = await sendSummaryBucket(db, { organizationId: ORG, key: KEY })
    expect(buildExportBatches).not.toHaveBeenCalled()
    expect(result._unsafeUnwrap()).toMatchObject({ batchId: 'b_1', built: false })
  })

  it('retries a failed batch as a person', async () => {
    const db = fakeDb([[{ id: 'b_1', state: 'failed' }]])
    await sendSummaryBucket(db, { organizationId: ORG, key: KEY })
    expect(sendExportBatch.mock.calls[0]?.[1]).toMatchObject({ batchId: 'b_1', manual: true })
  })

  it('refuses a sent batch', async () => {
    const db = fakeDb([[{ id: 'b_1', state: 'sent' }]])
    const result = await sendSummaryBucket(db, { organizationId: ORG, key: KEY })
    expect(result._unsafeUnwrapErr().name).toBe('ConflictError')
    expect(sendExportBatch).not.toHaveBeenCalled()
  })

  it('refuses when the build made no journal', async () => {
    readUnbuiltSummaryMembers.mockResolvedValue(ok([{ txnDate: '2026-02-03' }]))
    buildExportBatches.mockResolvedValue(ok({ batchIds: [] }))
    const result = await sendSummaryBucket(fakeDb([[], []]), { organizationId: ORG, key: KEY })
    expect(result._unsafeUnwrapErr().name).toBe('UnprocessableEntityError')
    expect(sendExportBatch).not.toHaveBeenCalled()
  })
})

describe('rebuildSummaryBucket', () => {
  it('rolls back the sent batch, then builds and sends the bucket again', async () => {
    rollbackExportBatch.mockResolvedValue(
      ok({ batchId: 'b_old', status: 'withdrawn', postingsFreed: 3 })
    )
    readUnbuiltSummaryMembers.mockResolvedValue(ok([{ txnDate: '2026-02-03' }]))
    buildExportBatches.mockResolvedValue(ok({ batchIds: ['b_new'] }))
    const db = fakeDb([[{ id: 'b_old', state: 'sent' }], [], [{ id: 'b_new', state: 'ready' }]])

    const result = await rebuildSummaryBucket(db, { organizationId: ORG, key: KEY })

    expect(rollbackExportBatch.mock.calls[0]?.[1]).toMatchObject({ batchId: 'b_old' })
    expect(result._unsafeUnwrap()).toMatchObject({
      batchId: 'b_new',
      sent: { batchId: 'b_new', built: true },
    })
  })

  it('stops at a refused rollback', async () => {
    rollbackExportBatch.mockResolvedValue(
      ok({ batchId: 'b_old', status: 'refused', message: 'closed', postingsFreed: 0 })
    )
    const db = fakeDb([[{ id: 'b_old', state: 'sent' }]])
    const result = await rebuildSummaryBucket(db, { organizationId: ORG, key: KEY })
    expect(result._unsafeUnwrap()).toMatchObject({ batchId: 'b_old', sent: null })
    expect(buildExportBatches).not.toHaveBeenCalled()
  })

  it('refuses a bucket that is not sent', async () => {
    const db = fakeDb([[{ id: 'b_1', state: 'ready' }]])
    const result = await rebuildSummaryBucket(db, { organizationId: ORG, key: KEY })
    expect(result._unsafeUnwrapErr().name).toBe('ConflictError')
    expect(rollbackExportBatch).not.toHaveBeenCalled()
  })
})
