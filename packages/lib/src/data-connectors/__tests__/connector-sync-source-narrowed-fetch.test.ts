// packages/lib/src/data-connectors/__tests__/connector-sync-source-narrowed-fetch.test.ts
// v13 U2 — what the paged fetch sends, and the N4 reconcile skip.

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

function sliceCtx(phase: 'backfill' | 'steady' = 'backfill'): SyncSliceCtx {
  return {
    phase,
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

function stream(over: Partial<SyncSourceStream> = {}): SyncSourceStream {
  return {
    streamId: 's1',
    streamKey: 'order',
    syncMode: 'incremental',
    mappings: [mapping('ignore')],
    ...over,
  }
}

function emptyPage(): FetchResult {
  async function* page() {}
  return { records: page(), nextState: {} }
}

function deps(
  over: Partial<ConnectorSyncSourceDeps>,
  fetchMock: ReturnType<typeof vi.fn>,
  definitionKind = 'app'
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
    connector: { id: 'dc1', credentialId: null, definitionKind } as never,
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

beforeEach(() => {
  reconcileOrphans.mockClear()
})

describe('fetchSlice — the send list', () => {
  it('sends the stored filter and the backfill floor to an app stream', async () => {
    const fetchMock = vi.fn().mockResolvedValue(emptyPage())
    const s = stream({ recordFilter: HAS_ORDERS, periodField: 'createdAt', backfillFloor: FLOOR })
    await createConnectorStreamSyncSource(deps({ stream: s }, fetchMock)).fetchSlice(sliceCtx())

    expect(fetchMock.mock.calls[0]![0].recordFilter).toEqual([
      { fieldId: 'orders_count', operator: '>', value: 0 },
      { fieldId: 'createdAt', operator: 'between', value: { from: FLOOR }, exact: true },
    ])
  })

  it('never sends the floor in the steady phase', async () => {
    const fetchMock = vi.fn().mockResolvedValue(emptyPage())
    const s = stream({ periodField: 'createdAt', backfillFloor: FLOOR })
    await createConnectorStreamSyncSource(deps({ stream: s }, fetchMock)).fetchSlice(
      sliceCtx('steady')
    )

    expect(fetchMock.mock.calls[0]![0]).not.toHaveProperty('recordFilter')
  })

  it("withholds the stored filter from a snapshot stream with orphanBehavior 'archive'", async () => {
    const fetchMock = vi.fn().mockResolvedValue(emptyPage())
    const s = stream({
      syncMode: 'snapshot',
      mappings: [mapping('archive')],
      recordFilter: HAS_ORDERS,
    })
    await createConnectorStreamSyncSource(deps({ stream: s }, fetchMock)).fetchSlice(sliceCtx())

    expect(fetchMock.mock.calls[0]![0]).not.toHaveProperty('recordFilter')
  })

  it('sends a re-import its run clauses in place of the floor, in any phase', async () => {
    const fetchMock = vi.fn().mockResolvedValue(emptyPage())
    const august = {
      fieldId: 'createdAt',
      operator: 'between',
      value: { from: FLOOR },
      exact: true,
    }
    const s = stream({ recordFilter: HAS_ORDERS, periodField: 'createdAt', backfillFloor: 'F0' })
    const run = { id: 'run1', startedAt: new Date(), mode: 'reimport', recordFilter: [august] }
    await createConnectorStreamSyncSource(deps({ stream: s, run }, fetchMock)).fetchSlice(
      sliceCtx('steady')
    )

    const args = fetchMock.mock.calls[0]![0]
    expect(args.mode).toBe('snapshot')
    expect(args.recordFilter).toEqual([
      { fieldId: 'orders_count', operator: '>', value: 0 },
      august,
    ])
  })

  it('sends nothing for a non-app connector', async () => {
    const fetchMock = vi.fn().mockResolvedValue(emptyPage())
    const s = stream({ recordFilter: HAS_ORDERS, periodField: 'createdAt', backfillFloor: FLOOR })
    await createConnectorStreamSyncSource(deps({ stream: s }, fetchMock, 'builtin')).fetchSlice(
      sliceCtx()
    )

    expect(fetchMock.mock.calls[0]![0]).not.toHaveProperty('recordFilter')
  })
})

describe('finalize — a narrowed fetch never deletes by absence (N4)', () => {
  it('reconciles the un-narrowed snapshot stream and skips the floored one', async () => {
    const floored = stream({
      streamId: 's-floored',
      syncMode: 'snapshot',
      mappings: [mapping('archive')],
      periodField: 'createdAt',
      backfillFloor: FLOOR,
    })
    const plain = stream({
      streamId: 's-plain',
      syncMode: 'snapshot',
      mappings: [mapping('archive')],
    })
    const source = createConnectorStreamSyncSource(
      deps({ stream: floored, allStreams: [floored, plain] }, vi.fn())
    )

    await source.finalizeBackfill?.()

    expect(reconcileOrphans).toHaveBeenCalledTimes(1)
    const streams = (reconcileOrphans.mock.calls[0] as unknown[])[1] as SyncSourceStream[]
    expect(streams.map((s) => s.streamId)).toEqual(['s-plain'])
  })
})
