// packages/lib/src/data-connectors/teardown.test.ts
//
// The teardown chain replaces an inline loop that could not finish (23,265
// records inside one HTTP request) and that discarded every per-record failure
// while still reporting success. These tests pin the four properties that make
// the replacement safe: the status is the claim, the chain continues only while
// there is work, refusals are recorded rather than swallowed, and a slice that
// removes nothing stops instead of looping forever.

import { ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  enqueueConnectorTeardown: vi.fn(async (_d: unknown, _o?: { dedupe?: boolean }) => {}),
  finalizeConnectorTeardown: vi.fn(async () => ({ success: true })),
  bulkDelete: vi.fn(async (_ids: string[]) => ({ count: 0, errors: [] as unknown[] })),
  bulkArchive: vi.fn(async (_ids: string[]) => ({ count: 0 })),
  /** Successive slices' worth of minted rows. */
  batches: [] as Array<Array<{ id: string; defId: string }>>,
  update: vi.fn(),
  connector: { id: 'conn_1', status: 'deleting' } as { id: string; status: string } | undefined,
}))

vi.mock('./data-connector-queue', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  enqueueConnectorTeardown: h.enqueueConnectorTeardown,
}))
vi.mock('./mutations', () => ({
  finalizeConnectorTeardown: h.finalizeConnectorTeardown,
}))
vi.mock('../resources/crud/unified-handler', () => ({
  UnifiedCrudHandler: class {
    bulkDelete = h.bulkDelete
    bulkArchive = h.bulkArchive
  },
}))

import { runConnectorTeardownSlice } from './teardown'

/**
 * Minimal Drizzle stand-in: `selectDistinct(...)...limit()` yields the next
 * queued batch, and `update(...)` records the connector patch.
 */
function db() {
  const chain: Record<string, unknown> = {}
  for (const method of ['from', 'innerJoin', 'where', 'groupBy']) {
    chain[method] = () => chain
  }
  chain.limit = async () => h.batches.shift() ?? []

  return {
    query: { DataConnector: { findFirst: async () => h.connector } },
    selectDistinct: () => chain,
    update: () => ({ set: (patch: unknown) => ({ where: async () => h.update(patch) }) }),
  } as never
}

const job = (behavior: 'archive' | 'delete' = 'delete') => ({
  connectorId: 'conn_1',
  organizationId: 'org_1',
  userId: 'user_1',
  behavior,
})

beforeEach(() => {
  vi.clearAllMocks()
  h.batches = []
  h.connector = { id: 'conn_1', status: 'deleting' }
  h.bulkDelete.mockResolvedValue({ count: 0, errors: [] })
  h.bulkArchive.mockResolvedValue({ count: 0 })
})

describe('runConnectorTeardownSlice — the status is the claim', () => {
  it('stops when the connector is already gone', async () => {
    h.connector = undefined

    const outcome = await runConnectorTeardownSlice(db(), job())

    expect(outcome).toEqual({ processed: 0, failed: 0, finished: true })
    expect(h.enqueueConnectorTeardown).not.toHaveBeenCalled()
    expect(h.finalizeConnectorTeardown).not.toHaveBeenCalled()
  })

  it('stops when the connector is no longer marked deleting', async () => {
    // Someone resumed it, or a sibling slice already finished. Continuing would
    // delete records out from under a connector that is live again.
    h.connector = { id: 'conn_1', status: 'live' }
    h.batches = [[{ id: 'inst_1', defId: 'def_1' }]]

    const outcome = await runConnectorTeardownSlice(db(), job())

    expect(outcome.finished).toBe(false)
    expect(h.bulkDelete).not.toHaveBeenCalled()
    expect(h.enqueueConnectorTeardown).not.toHaveBeenCalled()
  })
})

describe('runConnectorTeardownSlice — the chain', () => {
  it('removes a batch and enqueues the next slice', async () => {
    h.batches = [
      [
        { id: 'inst_1', defId: 'def_1' },
        { id: 'inst_2', defId: 'def_2' },
      ],
    ]
    h.bulkDelete.mockResolvedValue({ count: 2, errors: [] })

    const outcome = await runConnectorTeardownSlice(db(), job())

    expect(h.bulkDelete).toHaveBeenCalledWith(['def_1:inst_1', 'def_2:inst_2'])
    expect(outcome).toEqual({ processed: 2, failed: 0, finished: false })
    expect(h.enqueueConnectorTeardown).toHaveBeenCalledWith(job())
    // Nothing is finalized while records remain.
    expect(h.finalizeConnectorTeardown).not.toHaveBeenCalled()
  })

  it('enqueues the successor WITHOUT a dedup id', async () => {
    // 🛑 The regression this pins, seen live: the continuation reused the
    // opening enqueue's fixed `jobId`. This handler is still active and still
    // holds that id, so BullMQ returned the existing job and added nothing —
    // the chain ran exactly ONE slice and parked the connector in `deleting`
    // with 19,600 of 21,654 records still there.
    h.batches = [[{ id: 'inst_1', defId: 'def_1' }]]
    h.bulkDelete.mockResolvedValue({ count: 1, errors: [] })

    await runConnectorTeardownSlice(db(), job())

    expect(h.enqueueConnectorTeardown).toHaveBeenCalledTimes(1)
    const [, opts] = h.enqueueConnectorTeardown.mock.calls[0] ?? []
    expect(opts?.dedupe).toBeFalsy()
  })

  it('finalizes and stops when no minted records are left', async () => {
    h.batches = [[]]

    const outcome = await runConnectorTeardownSlice(db(), job())

    expect(outcome.finished).toBe(true)
    expect(h.finalizeConnectorTeardown).toHaveBeenCalledWith(
      expect.anything(),
      'org_1',
      'user_1',
      'conn_1',
      'delete'
    )
    expect(h.enqueueConnectorTeardown).not.toHaveBeenCalled()
  })

  it('archives instead of deleting when the behaviour says so', async () => {
    h.batches = [[{ id: 'inst_1', defId: 'def_1' }]]
    h.bulkArchive.mockResolvedValue({ count: 1 })

    const outcome = await runConnectorTeardownSlice(db(), job('archive'))

    expect(h.bulkArchive).toHaveBeenCalledWith(['def_1:inst_1'])
    expect(h.bulkDelete).not.toHaveBeenCalled()
    expect(outcome.processed).toBe(1)
  })
})

describe('runConnectorTeardownSlice — failures are recorded, not swallowed', () => {
  it('parks the distinct refusal reasons on the connector and keeps going', async () => {
    // The inline teardown this replaces discarded `BulkDeleteResult` entirely
    // and still returned `{ success: true }`, so a settled-period refusal from
    // `guardPartDelete` vanished without trace.
    h.batches = [
      [
        { id: 'inst_1', defId: 'def_1' },
        { id: 'inst_2', defId: 'def_1' },
      ],
    ]
    h.bulkDelete.mockResolvedValue({
      count: 1,
      errors: [{ recordId: 'def_1:inst_2', message: 'This part has 3 stock movements' }],
    })

    const outcome = await runConnectorTeardownSlice(db(), job())

    expect(outcome).toEqual({ processed: 1, failed: 1, finished: false })
    expect(h.update).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.stringContaining('This part has 3 stock movements'),
      })
    )
    // Progress was made, so the chain continues.
    expect(h.enqueueConnectorTeardown).toHaveBeenCalled()
  })

  it('stops the chain when a slice removes nothing at all', async () => {
    // Every record refused, so the next slice would re-read the same rows and
    // refuse them again — an endless chain burning a worker slot.
    h.batches = [[{ id: 'inst_1', defId: 'def_1' }]]
    h.bulkDelete.mockResolvedValue({
      count: 0,
      errors: [{ recordId: 'def_1:inst_1', message: 'settled period' }],
    })

    const outcome = await runConnectorTeardownSlice(db(), job())

    expect(outcome).toEqual({ processed: 0, failed: 1, finished: false })
    expect(h.enqueueConnectorTeardown).not.toHaveBeenCalled()
    // The connector stays `deleting` with its reason set, for a human to resolve.
    expect(h.finalizeConnectorTeardown).not.toHaveBeenCalled()
  })

  it('collapses repeated reasons — the user needs the reason, not 400 copies', async () => {
    h.batches = [[{ id: 'inst_1', defId: 'def_1' }]]
    h.bulkDelete.mockResolvedValue({
      count: 1,
      errors: Array.from({ length: 40 }, (_, i) => ({
        recordId: `def_1:inst_${i}`,
        message: 'settled period',
      })),
    })

    await runConnectorTeardownSlice(db(), job())

    const patch = h.update.mock.calls[0]?.[0] as { error: string }
    expect(patch.error).toBe('40 record(s) could not be removed. settled period')
  })
})
