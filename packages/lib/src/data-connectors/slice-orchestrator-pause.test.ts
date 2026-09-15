// packages/lib/src/data-connectors/slice-orchestrator-pause.test.ts
import type { Database } from '@auxx/database'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SliceResult, SyncState } from '../sync-core/contracts'

const h = vi.hoisted(() => ({
  pausing: false,
  state: {} as SyncState,
  fetchSlice: vi.fn<() => Promise<SliceResult>>(),
  finalizePause: vi.fn(),
  enqueue: vi.fn(),
  recordSlice: vi.fn(),
  finalizeBackfill: vi.fn(),
}))
vi.mock('./connector-runtime', () => ({
  prepareConnectorFetch: async () => ({ definition: {}, credential: {} }),
}))
vi.mock('./connector-sync-source', () => ({
  createConnectorStreamSyncSource: () => ({
    id: 'source',
    throttleKey: 'source',
    fetchSlice: h.fetchSlice,
    finalizePause: h.finalizePause,
    finalizeBackfill: h.finalizeBackfill,
  }),
}))
vi.mock('./data-connector-queue', () => ({ enqueueBackfillSlice: h.enqueue }))
vi.mock('./realtime', () => ({ publishConnectorSync: vi.fn() }))
vi.mock('../sync-core/throttle', () => ({
  createThrottleHandle: () => ({ run: (fn: () => unknown) => fn() }),
}))
vi.mock('./sync-core-adapters', () => ({
  createStreamSyncStateStore: () => ({
    load: async () => h.state,
    save: async (state: SyncState) => {
      h.state = state
    },
  }),
  createConnectorRunLedger: () => ({ recordSlice: h.recordSlice, fail: vi.fn() }),
}))
vi.mock('./service', async (original) => ({
  ...(await original<typeof import('./service')>()),
  getRunFetched: async () => 2,
  setRunRateLimited: vi.fn(),
}))

import { runBackfillSlice } from './slice-orchestrator'

const data = { connectorId: 'connector', organizationId: 'org', streamId: 'stream', runId: 'run' }
const db = {
  query: {
    DataConnectorRun: {
      findFirst: async () => ({
        id: 'run',
        status: 'running',
        phase: 'backfill',
        startedAt: new Date(),
        sampleLimit: null,
        chainSnapshot: { streams: [{ streamId: 'stream' }] },
      }),
    },
    DataConnector: { findFirst: async () => ({ id: 'connector', status: 'syncing' }) },
  },
} as unknown as Database

beforeEach(() => {
  vi.clearAllMocks()
  h.pausing = false
  h.state = { phase: 'backfill', cursor: { kind: 'token', value: 'page-1' } }
  h.finalizePause.mockImplementation(async () => h.pausing)
  h.fetchSlice.mockResolvedValue({
    recordsProcessed: 2,
    pagesProcessed: 1,
    hasMore: true,
    nextCursor: { kind: 'token', value: 'page-2' },
    commit: 'all',
    counters: { fetched: 2 },
  })
})

describe('manual pause in the slice orchestrator', () => {
  it('acknowledges queued work without fetching or changing its saved cursor', async () => {
    h.pausing = true
    await runBackfillSlice(db, data)
    expect(h.fetchSlice).not.toHaveBeenCalled()
    expect(h.enqueue).not.toHaveBeenCalled()
    expect(h.state.cursor?.value).toBe('page-1')
  })

  it('checkpoints an active slice before acknowledging pause and does not enqueue another slice', async () => {
    h.fetchSlice.mockImplementation(async () => {
      h.pausing = true
      return {
        recordsProcessed: 2,
        pagesProcessed: 1,
        hasMore: true,
        nextCursor: { kind: 'token', value: 'page-2' },
        commit: 'all',
        counters: { fetched: 2 },
      }
    })
    h.finalizePause.mockImplementation(async () => {
      if (h.pausing) {
        expect(h.state.cursor?.value).toBe('page-2')
        expect(h.recordSlice).toHaveBeenCalledTimes(1)
      }
      return h.pausing
    })
    await runBackfillSlice(db, data)
    expect(h.enqueue).not.toHaveBeenCalled()
    expect(h.finalizeBackfill).not.toHaveBeenCalled()
  })

  it('continues an unpaused run from the same checkpoint', async () => {
    await runBackfillSlice(db, data)
    expect(h.state.cursor?.value).toBe('page-2')
    expect(h.enqueue).toHaveBeenCalledWith(data, { delayMs: undefined })
  })
})
