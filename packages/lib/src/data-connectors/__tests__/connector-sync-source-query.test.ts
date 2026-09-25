// packages/lib/src/data-connectors/__tests__/connector-sync-source-query.test.ts
// v14 §3 — the query each job sends, and which finalize reconciles.

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

const reconcileOrphans = vi.fn(async () => {})
vi.mock('../reconciliation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../reconciliation')>()
  return {
    ...actual,
    reconcileOrphans: (...args: unknown[]) => reconcileOrphans(...(args as [])),
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
vi.mock('../service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../service')>()
  return {
    ...actual,
    parkConnectorIfManuallyPaused: async () => false,
    decrementConnectorBackfillLatch: async () => 0,
    finalizeConnector: async () => {},
    countConnectorItems: async () => 0,
    clearResyncPending: async () => {},
    publishSyncRecordsChanged: async () => {},
    getRunManifest: async () => null,
  }
})

import type { ConditionGroup } from '../../conditions/types'
import type { SyncSliceCtx } from '../../sync-core/contracts'
import type { ConnectorSyncSourceDeps, SyncSourceStream } from '../connector-sync-source'
import { createConnectorStreamSyncSource } from '../connector-sync-source'
import { encodeSince } from '../connectors/app-connector-state'
import type { DataConnectorDefinition, FetchResult } from '../connectors/types'
import type { DecodedMapping } from '../service'

const BUDGET = { maxPages: 10, maxRecords: 1_000, maxMs: 1_000_000 }
const FLOOR = '2026-06-26T00:00:00.000Z'

const HAS_ORDERS: ConditionGroup[] = [
  {
    id: 'g1',
    logicalOperator: 'AND',
    conditions: [{ id: 'c0', fieldId: 'orders_count', operator: '>', value: 0 }],
  } as ConditionGroup,
]

function sliceCtx(phase: 'backfill' | 'steady' = 'backfill', watermark?: string): SyncSliceCtx {
  return {
    phase,
    watermark,
    budget: BUDGET,
    throttle: { run: (fn: () => unknown) => fn() },
    signal: new AbortController().signal,
  } as SyncSliceCtx
}

function mapping(orphanBehavior: DecodedMapping['orphanBehavior']): DecodedMapping {
  return {
    row: { id: `m-${orphanBehavior}` },
    rootPath: '',
    linkMode: 'upsert',
    targetMode: 'owned',
    entityDefinitionId: 'def1',
    parentMappingId: null,
    relationshipFieldKey: null,
    orphanBehavior,
    fieldMappings: [],
  } as unknown as DecodedMapping
}

/** An app `order` stream: ids, a period path and a since marker. */
function stream(over: Partial<SyncSourceStream> = {}): SyncSourceStream {
  return {
    streamId: 's1',
    streamKey: 'order',
    syncMode: 'incremental',
    query: { ids: true, period: 'created_at', since: true },
    mappings: [mapping('ignore')],
    ...over,
  }
}

function emptyPage(): FetchResult {
  async function* page() {}
  return { records: page() }
}

function deps(
  over: Partial<ConnectorSyncSourceDeps>,
  fetchMock: ReturnType<typeof vi.fn>
): ConnectorSyncSourceDeps {
  const definition: DataConnectorDefinition = {
    type: 'app:test',
    schemaVersion: 1,
    requestModel: 'fixed',
    streams: [],
    fetch: fetchMock as unknown as DataConnectorDefinition['fetch'],
  }
  return {
    db: {} as never,
    organizationId: 'org1',
    connector: { id: 'dc1', credentialId: null, definitionKind: 'app' } as never,
    definition,
    credential: null,
    config: {},
    run: { id: 'run1', startedAt: new Date(), phase: 'backfill' },
    stream: stream(),
    allStreams: [],
    now: () => 0,
    ...over,
  } as ConnectorSyncSourceDeps
}

/** The query the first fetch of one slice sent. */
async function sentQuery(
  over: Partial<ConnectorSyncSourceDeps>,
  ctx: SyncSliceCtx = sliceCtx()
): Promise<Record<string, unknown>> {
  const fetchMock = vi.fn().mockResolvedValue(emptyPage())
  await createConnectorStreamSyncSource(deps(over, fetchMock)).fetchSlice(ctx)
  return fetchMock.mock.calls[0]![0]
}

beforeEach(() => {
  reconcileOrphans.mockClear()
})

describe('fetchSlice — the query per job', () => {
  it('backfill: the floor on a period stream, and never the stored record filter', async () => {
    const args = await sentQuery({ stream: stream({ recordFilter: HAS_ORDERS }), floor: FLOOR })
    expect(args.query).toEqual({ period: { from: FLOOR } })
    expect(args).not.toHaveProperty('recordFilter')
  })

  it('backfill without a history date: {}', async () => {
    expect((await sentQuery({})).query).toEqual({})
  })

  it('backfill never sends since, even with a watermark left over', async () => {
    const ctx = sliceCtx('backfill', encodeSince('2026-09-01'))
    expect((await sentQuery({ floor: FLOOR }, ctx)).query).toEqual({ period: { from: FLOOR } })
  })

  it('steady since stream: the floor rides along with the decoded since', async () => {
    const since = { updatedAt: '2026-09-01T00:00:00Z' }
    const args = await sentQuery({ floor: FLOOR }, sliceCtx('steady', encodeSince(since)))
    expect(args.query).toEqual({ period: { from: FLOOR }, since })
  })

  it('steady since stream after a restart (no watermark): no since', async () => {
    expect((await sentQuery({}, sliceCtx('steady'))).query).toEqual({})
  })

  it('a sweep sends the steady query', async () => {
    const args = await sentQuery(
      { floor: FLOOR, sweep: true },
      sliceCtx('steady', encodeSince('s'))
    )
    expect(args.query).toEqual({ period: { from: FLOOR }, since: 's' })
  })

  it('a period-only rescan stream gets the floor on every run', async () => {
    const payout = stream({ syncMode: 'snapshot', query: { period: 'issued_at' } })
    expect((await sentQuery({ stream: payout, floor: FLOOR })).query).toEqual({
      period: { from: FLOOR },
    })
  })

  it('a stream without a period ignores the floor', async () => {
    const product = stream({ syncMode: 'snapshot', query: { ids: true } })
    expect((await sentQuery({ stream: product, floor: FLOOR })).query).toEqual({})
  })

  it('a re-import sends its own query verbatim, as a snapshot, in any phase', async () => {
    const run = {
      id: 'run1',
      startedAt: new Date(),
      mode: 'reimport',
      query: { period: { from: FLOOR, to: '2026-07-01T00:00:00.000Z' } },
    }
    const args = await sentQuery({ run, floor: 'ignored' }, sliceCtx('steady', encodeSince('s')))
    expect(args.query).toEqual(run.query)
    expect(args.mode).toBe('snapshot')
  })

  it('generic REST: the floor on a backfillWindow stream, and never since', async () => {
    const rest = stream({
      query: undefined,
      requestConfig: { path: 'charges', backfillWindow: { sinceParam: 'created[gte]' } },
    })
    const args = await sentQuery({ stream: rest, floor: FLOOR }, sliceCtx('steady', '2026-09-01'))
    expect(args.query).toEqual({ period: { from: FLOOR } })
  })
})

describe('finalize — only an unbounded {} fetch deletes by absence', () => {
  it('reconciles the floorless snapshot stream and skips the floored and the delta ones', async () => {
    const floored = stream({
      streamId: 's-floored',
      syncMode: 'snapshot',
      query: { period: 'created_at' },
      mappings: [mapping('archive')],
    })
    const plain = stream({
      streamId: 's-plain',
      syncMode: 'snapshot',
      query: { ids: true },
      mappings: [mapping('archive')],
    })
    const delta = stream({ streamId: 's-delta', mappings: [mapping('archive')] })
    const source = createConnectorStreamSyncSource(
      deps({ stream: floored, allStreams: [floored, plain, delta], floor: FLOOR }, vi.fn())
    )

    await source.finalizeBackfill?.()

    expect(reconcileOrphans).toHaveBeenCalledTimes(1)
    const streams = (reconcileOrphans.mock.calls[0] as unknown[])[1] as SyncSourceStream[]
    expect(streams.map((s) => s.streamId)).toEqual(['s-plain'])
  })

  it('without a history date the period stream is unbounded and reconciles', async () => {
    const payout = stream({
      syncMode: 'snapshot',
      query: { period: 'issued_at' },
      mappings: [mapping('archive')],
    })
    const source = createConnectorStreamSyncSource(
      deps({ stream: payout, allStreams: [payout] }, vi.fn())
    )

    await source.finalizeBackfill?.()

    const streams = (reconcileOrphans.mock.calls[0] as unknown[])[1] as SyncSourceStream[]
    expect(streams.map((s) => s.streamId)).toEqual(['s1'])
  })

  it('a re-import never reconciles', async () => {
    const plain = stream({ syncMode: 'snapshot', mappings: [mapping('archive')] })
    const run = { id: 'run1', startedAt: new Date(), mode: 'reimport', query: { ids: ['1'] } }
    const source = createConnectorStreamSyncSource(
      deps({ stream: plain, allStreams: [plain], run }, vi.fn())
    )

    await source.finalizeBackfill?.()

    expect(reconcileOrphans).not.toHaveBeenCalled()
  })
})
