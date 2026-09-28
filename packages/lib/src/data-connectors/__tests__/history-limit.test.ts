// packages/lib/src/data-connectors/__tests__/history-limit.test.ts
// v15 §3.5–§3.6 — the history limit ends a backfill as a completion, and coverage.

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../record-rules/sync-manifest-collector', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../record-rules/sync-manifest-collector')>()
  return { ...actual, loadManifestCollector: async () => actual.createManifestCollector({}) }
})
vi.mock('../../resources/crud/unified-handler', () => ({
  UnifiedCrudHandler: class {
    async warmCache() {}
  },
}))
vi.mock('../reconciliation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../reconciliation')>()
  return {
    ...actual,
    reconcileOrphans: async () => {},
    reconcileManagedMarkers: async () => {},
    listBackfillRunIds: async () => new Set<string>(),
  }
})
vi.mock('../relationship-pass', () => ({ resolveRelationships: async () => {} }))
vi.mock('../cross-connector-links', async () => {
  const { ok } = await import('neverthrow')
  return { resolveCrossConnectorLinks: async () => ok(undefined) }
})
vi.mock('../sync-core-adapters', () => ({
  createConnectorRunLedger: () => ({
    recordSlice: async () => {},
    finalize: async () => {},
    fail: async () => {},
  }),
}))
vi.mock('../../realtime', () => ({
  getRealtimeService: () => ({}),
  publishRecordsInvalidated: async () => {},
  publishRunCompleted: async () => {},
}))
vi.mock('../sink-source-record', () => ({
  sinkSourceRecord: async () => {},
  sinkSourcePage: async () => {},
}))
vi.mock('../run-control', () => ({ isRunPauseRequested: async () => false }))

const decrementLatch = vi.fn(async () => 0)
const parkSample = vi.fn(async () => {})
vi.mock('../service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../service')>()
  return {
    ...actual,
    parkConnectorIfManuallyPaused: async () => false,
    parkConnectorSampleIfLastStream: (...a: unknown[]) => parkSample(...(a as [])),
    decrementConnectorBackfillLatch: (...a: unknown[]) => decrementLatch(...(a as [])),
    finalizeConnector: async () => {},
    countConnectorItems: async () => 0,
    clearResyncPending: async () => {},
    publishSyncRecordsChanged: async () => {},
    getRunManifest: async () => null,
  }
})

const writeStreamCoverage = vi.fn(async () => {})
const markRunStreamStopped = vi.fn(async () => {})
vi.mock('../coverage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../coverage')>()
  return {
    ...actual,
    writeStreamCoverage: (...a: unknown[]) => writeStreamCoverage(...(a as [])),
    markRunStreamStopped: (...a: unknown[]) => markRunStreamStopped(...(a as [])),
  }
})

import type { SyncState, SyncStateStore } from '../../sync-core/contracts'
import { runSyncSlice } from '../../sync-core/slice-runner'
import type { ConnectorSyncSourceDeps, SyncSourceStream } from '../connector-sync-source'
import { createConnectorStreamSyncSource } from '../connector-sync-source'
import type { ConnectorYield, DataConnectorDefinition } from '../connectors/types'
import { extendedCoverage } from '../coverage'
import type { DecodedMapping } from '../service'

const FLOOR = '2025-01-01T00:00:00.000Z'
const BUDGET = { maxPages: 100, maxRecords: 100_000, maxMs: 1_000_000 }

/** Three newest-first pages of two orders each; every page reports `since`, or none when `withSince` is off. */
function pages(withSince: boolean): ConnectorYield[][] {
  const order = (id: string, createdAt: string): ConnectorYield => ({
    streamKey: 'order',
    fields: { id, created_at: createdAt },
  })
  const cp = (cursor?: string): ConnectorYield => ({
    __checkpoint: true,
    ...(cursor ? { cursor: { kind: 'token', value: cursor } } : {}),
    ...(withSince ? { since: '"t0"' } : {}),
  })
  return [
    [order('6', '2026-06-01T00:00:00Z'), order('5', '2026-05-01T00:00:00Z'), cp('p2')],
    [order('4', '2026-04-01T00:00:00Z'), order('3', '2026-03-01T00:00:00Z'), cp('p3')],
    [order('2', '2026-02-01T00:00:00Z'), order('1', '2026-01-01T00:00:00Z'), cp()],
  ]
}

/** A fetch that resumes from the checkpointed page cursor. */
function pagedFetch(seq: ConnectorYield[][]): DataConnectorDefinition['fetch'] {
  return (async (args: { state?: { backfillCursor?: { value: string } } }) => {
    const start = args.state?.backfillCursor
      ? Number(args.state.backfillCursor.value.slice(1)) - 1
      : 0
    return {
      records: (async function* () {
        for (const page of seq.slice(start)) yield* page
      })(),
    }
  }) as unknown as DataConnectorDefinition['fetch']
}

function stream(query: SyncSourceStream['query']): SyncSourceStream {
  return {
    streamId: 's1',
    streamKey: 'order',
    syncMode: 'incremental',
    query,
    mappings: [{ row: { id: 'm1' }, entityDefinitionId: 'def1' } as unknown as DecodedMapping],
  }
}

function memoryStore(initial: SyncState) {
  let current = initial
  const store: SyncStateStore = {
    load: async () => current,
    save: async (s) => {
      current = s
    },
  }
  return { store, get: () => current }
}

async function runOnce(over: {
  query?: SyncSourceStream['query']
  withSince?: boolean
  limit?: number
  state?: SyncState
  floor?: string
  backfilledBefore?: boolean
  resyncPending?: string[]
  headroom?: number | null
}) {
  const deps = {
    db: {} as never,
    organizationId: 'org1',
    connector: {
      id: 'dc1',
      credentialId: null,
      definitionKind: 'app',
      resyncPending: over.resyncPending ? { streamIds: over.resyncPending } : null,
    } as never,
    definition: {
      type: 'app:test',
      schemaVersion: 1,
      requestModel: 'fixed',
      streams: [],
      fetch: pagedFetch(pages(over.withSince ?? true)),
    },
    credential: null,
    config: over.limit ? { historyMaxRecords: over.limit } : {},
    run: { id: 'run1', startedAt: new Date(), phase: 'backfill' },
    stream: stream(over.query ?? { ids: true, period: 'created_at', since: true, limit: true }),
    allStreams: [],
    floor: over.floor,
    backfilledBefore: over.backfilledBefore,
    recordsHeadroom: over.headroom,
    now: () => 0,
  } as unknown as ConnectorSyncSourceDeps
  const state = memoryStore(over.state ?? { phase: 'backfill' })
  const outcome = await runSyncSlice({
    source: createConnectorStreamSyncSource(deps),
    stateStore: state.store,
    ledger: { recordSlice: async () => {}, finalize: async () => {}, fail: async () => {} },
    throttle: { run: (fn) => fn() },
    budget: BUDGET,
    signal: new AbortController().signal,
  })
  return { outcome, state: state.get() }
}

beforeEach(() => {
  decrementLatch.mockClear()
  parkSample.mockClear()
  writeStreamCoverage.mockClear()
  markRunStreamStopped.mockClear()
})

describe('history limit — capped stop', () => {
  it('stops within one page, goes steady on the provisional since and releases the latch', async () => {
    const { outcome, state } = await runOnce({ limit: 3 })

    expect(outcome).toEqual({ action: 'complete', completedPhase: 'backfill' })
    expect(state).toMatchObject({ phase: 'steady', watermark: '"t0"', recordsSeen: 4 })
    expect(state.cursor).toBeUndefined()
    expect(state.pendingSince).toBeUndefined()
    expect(decrementLatch).toHaveBeenCalledTimes(1)
    expect(parkSample).not.toHaveBeenCalled()
  })

  it('coverage is the last record’s period value, and the run records the stop', async () => {
    await runOnce({ limit: 3, floor: FLOOR })

    expect(writeStreamCoverage).toHaveBeenCalledWith({}, 's1', {
      coverageFrom: '2026-03-01T00:00:00.000Z',
      stoppedAtRecords: 4,
    })
    expect(markRunStreamStopped).toHaveBeenCalledWith({}, 'run1', 's1', 4)
  })

  it('counts records from earlier slices toward the limit', async () => {
    const { state } = await runOnce({
      limit: 3,
      state: { phase: 'backfill', cursor: { kind: 'token', value: 'p2' }, recordsSeen: 2 },
    })
    expect(state).toMatchObject({ phase: 'steady', recordsSeen: 4 })
  })

  it('stops at the org Records headroom with no connector limit set', async () => {
    const { state } = await runOnce({ headroom: 3 })
    expect(state).toMatchObject({ phase: 'steady', watermark: '"t0"', recordsSeen: 4 })
  })

  it('the lower of the connector limit and the org headroom wins', async () => {
    const { state } = await runOnce({ limit: 100, headroom: 1 })
    expect(state).toMatchObject({ phase: 'steady', recordsSeen: 2 })
  })

  it('headroom counts on from records seen in earlier slices', async () => {
    const { state } = await runOnce({
      headroom: 1,
      state: { phase: 'backfill', cursor: { kind: 'token', value: 'p2' }, recordsSeen: 2 },
    })
    expect(state).toMatchObject({ phase: 'steady', recordsSeen: 4 })
  })

  it('unlimited headroom and no connector limit crawls to the end', async () => {
    const { state } = await runOnce({ headroom: null })
    expect(state).toMatchObject({ phase: 'steady', recordsSeen: 6 })
  })

  it('without a provisional since it keeps crawling to the end', async () => {
    const { state } = await runOnce({ limit: 3, withSince: false })

    expect(state).toMatchObject({ phase: 'steady', recordsSeen: 6 })
    expect(markRunStreamStopped).not.toHaveBeenCalled()
  })

  it('a stream without query.limit ignores the setting; coverage is the floor', async () => {
    const { state } = await runOnce({
      limit: 3,
      floor: FLOOR,
      query: { ids: true, period: 'created_at', since: true },
    })

    expect(state).toMatchObject({ phase: 'steady', watermark: '"t0"', recordsSeen: 6 })
    expect(writeStreamCoverage).toHaveBeenCalledWith({}, 's1', {
      coverageFrom: FLOOR,
      stoppedAtRecords: null,
    })
  })

  it('a re-crawl after a completed backfill is not capped', async () => {
    const { state } = await runOnce({ limit: 3, floor: FLOOR, backfilledBefore: true })

    expect(state).toMatchObject({ phase: 'steady', watermark: '"t0"', recordsSeen: 6 })
    expect(markRunStreamStopped).not.toHaveBeenCalled()
    expect(writeStreamCoverage).toHaveBeenCalledWith({}, 's1', {
      coverageFrom: FLOOR,
      stoppedAtRecords: null,
    })
  })

  it('a stream with a pending re-sync is not capped', async () => {
    const { state } = await runOnce({ limit: 3, resyncPending: ['s1'] })

    expect(state).toMatchObject({ phase: 'steady', recordsSeen: 6 })
    expect(markRunStreamStopped).not.toHaveBeenCalled()
  })

  it('a stream without a period is not bounded by the floor, so it covers everything', async () => {
    await runOnce({ floor: FLOOR, query: { ids: true, since: true } })
    expect(writeStreamCoverage).toHaveBeenCalledWith({}, 's1', {
      coverageFrom: null,
      stoppedAtRecords: null,
    })
  })

  it('a crawl that ran out without a floor covers everything', async () => {
    await runOnce({})
    expect(writeStreamCoverage).toHaveBeenCalledWith({}, 's1', {
      coverageFrom: null,
      stoppedAtRecords: null,
    })
  })
})

describe('extendedCoverage', () => {
  const at = '2026-03-01T00:00:00.000Z'
  it('moves earlier when the period reaches back to the current coverage', () => {
    expect(extendedCoverage(at, { from: FLOOR, to: '2026-03-01T00:00:01.000Z' })).toBe(FLOOR)
    expect(extendedCoverage(at, { to: '2026-03-01T00:00:01Z' })).toBeNull()
  })
  it('needs `to` strictly past the coverage: the boundary second may hold unread records', () => {
    expect(extendedCoverage(at, { from: FLOOR, to: at })).toBeUndefined()
    expect(extendedCoverage(at, { from: FLOOR, to: '2026-03-01T00:00:00Z' })).toBeUndefined()
  })
  it('compares instants, not strings', () => {
    // 2026-03-01T01:00Z: later than the coverage although it sorts earlier as a string.
    expect(extendedCoverage(at, { from: '2026-02-28T20:00:00-05:00' })).toBeUndefined()
    expect(extendedCoverage(at, { from: '2026-02-28T18:00:00-05:00' })).toBe(
      '2026-02-28T18:00:00-05:00'
    )
  })
  it('leaves a gap, a later start, "everything" and unknown coverage alone', () => {
    expect(extendedCoverage(at, { from: FLOOR, to: '2026-02-01T00:00:00.000Z' })).toBeUndefined()
    expect(extendedCoverage(at, { from: '2026-04-01T00:00:00.000Z' })).toBeUndefined()
    expect(extendedCoverage(null, { from: FLOOR })).toBeUndefined()
    expect(extendedCoverage(undefined, { from: FLOOR })).toBeUndefined()
  })
})
