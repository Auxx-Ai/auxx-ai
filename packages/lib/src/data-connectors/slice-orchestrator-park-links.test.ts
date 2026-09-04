// packages/lib/src/data-connectors/slice-orchestrator-park-links.test.ts
// plans/money/tasks/39 §3.6: the relationship pass runs at the ingest-ceiling park.
// Same harness as `slice-orchestrator-resume.test.ts` (the real orchestrator, runner,
// sync source and relationship pass over an in-memory world), with the sink replaced
// by one that binds items and queues their edges, so the pass has real input.
//
// Two snapshot streams: `customers` (stream A, one small page) completes first;
// `orders` (stream B, 25 pages of 500) trips the 9 000 ceiling on its second slice.
// The first order on each page carries two edges: `customer` -> a customer (synced by
// A, so resolvable at the park) and `related_order` -> the first order of the LAST
// page (not fetched before the park, so B-dependent). Proves: the park links A's
// edges before the run is marked partial, leaves the B-dependent edges pending and
// counted as warnings, the count query reports them by target, and the resumed run's
// finalize resolves the rest so the count reads zero.

import { is, Param, SQL } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SyncState, SyncStateStore } from '../sync-core/contracts'
import type { DataConnectorItemRow, PendingRelation, PendingRelationTargetCount } from './service'
import type { ConnectorStreamState, DataConnectorDefinition } from './types'

// ── In-memory world ─────────────────────────────────────────────────────────────

interface FakeStream {
  id: string
  dataConnectorId: string
  organizationId: string
  streamKey: string
  syncMode: 'snapshot' | 'incremental'
  enabled: boolean
  requestConfig: null
  state: ConnectorStreamState
}

interface FakeRun {
  id: string
  dataConnectorId: string
  status: 'running' | 'completed' | 'partial' | 'failed'
  phase: 'backfill' | 'steady' | null
  trigger: string
  chainSnapshot: Record<string, unknown> | null
  startedAt: Date
  sampleLimit: number | null
  fetched: number
}

interface FakeItem {
  id: string
  entityDefinitionId: string
  entityInstanceId: string | null
  externalId: string
  pendingRelations: PendingRelation[] | null
  linkedRelations: string[] | null
  archivedAt: Date | null
}

interface LinkWrite {
  recordId: string
  values: Record<string, unknown>
  /** The run's status when the write happened: the park-time pass must precede the park. */
  runStatus: FakeRun['status'] | undefined
}

const DEFS: Record<string, { apiSlug: string; singular: string }> = {
  'def-customers': { apiSlug: 'contact', singular: 'Contact' },
  'def-orders': { apiSlug: 'order', singular: 'Order' },
}
const DEF_BY_STREAM: Record<string, string> = { customers: 'def-customers', orders: 'def-orders' }

const world = {
  streams: new Map<string, FakeStream>(),
  runs: [] as FakeRun[],
  runSeq: 0,
  connector: {} as Record<string, unknown>,
  latch: null as number | null,
  sliceQueue: [] as { streamId: string; runId: string }[],
  parkedAtCeiling: [] as string[],
  finalized: [] as { ok: boolean }[],
  items: new Map<string, FakeItem>(),
  linkWrites: [] as LinkWrite[],
  /** Counters handed to the run ledger by the park-time pass and the finalize. */
  ledgerFolds: [] as { runId: string; relationshipWarnings: number }[],
}

const PAGE_SIZE = 500
/** 25 pages x 500 = 12 500 orders: two slices (5 000 each) cross the 9 000 ceiling. */
const ORDER_PAGES = 25
const CUSTOMERS = 10

function resetWorld() {
  world.streams.clear()
  world.runs.length = 0
  world.runSeq = 0
  world.latch = null
  world.sliceQueue.length = 0
  world.parkedAtCeiling.length = 0
  world.finalized.length = 0
  world.items.clear()
  world.linkWrites.length = 0
  world.ledgerFolds.length = 0
  world.connector = {
    id: 'dc1',
    organizationId: 'org1',
    type: 'fixture',
    credentialId: null,
    appInstallationId: null,
    createdById: 'u1',
    config: {},
    state: null,
    status: 'live',
    resyncPending: null,
  }
  for (const streamKey of ['customers', 'orders'] as const) {
    world.streams.set(`s-${streamKey}`, {
      id: `s-${streamKey}`,
      dataConnectorId: 'dc1',
      organizationId: 'org1',
      streamKey,
      syncMode: 'snapshot',
      enabled: true,
      requestConfig: null,
      state: {},
    })
  }
}

function itemKey(def: string, externalId: string) {
  return `${def}::${externalId}`
}

function currentRun(runId: string) {
  return world.runs.find((r) => r.id === runId)
}

/** Collect every bound value out of a drizzle `where` tree (see the resume test). */
function paramValues(where: unknown): unknown[] {
  const out: unknown[] = []
  const walk = (chunk: unknown) => {
    if (is(chunk, SQL)) for (const c of chunk.queryChunks) walk(c)
    else if (is(chunk, Param)) out.push(chunk.value)
    else if (Array.isArray(chunk)) for (const c of chunk) walk(c)
    else if (typeof chunk === 'string' || chunk instanceof Date) out.push(chunk)
  }
  walk(where)
  return out
}

/**
 * The count aggregate over the in-memory items, shaped like the rows Postgres returns
 * for `countPendingRelationsByTarget` (live bound items, non-clear edges, grouped by
 * source and target def, largest first). The SQL itself is exercised against the dev
 * database; this keeps the real function's contract in the loop.
 */
function aggregatePendingLinks(): PendingRelationTargetCount[] {
  const groups = new Map<string, PendingRelationTargetCount & { itemIds: Set<string> }>()
  for (const item of world.items.values()) {
    if (item.archivedAt || !item.entityInstanceId) continue
    for (const edge of item.pendingRelations ?? []) {
      if (edge.targetExternalId === null || !edge.targetDef) continue
      const key = `${item.entityDefinitionId}::${edge.targetDef}`
      let g = groups.get(key)
      if (!g) {
        g = {
          sourceDef: item.entityDefinitionId,
          sourceLabel: DEFS[item.entityDefinitionId]!.singular,
          targetDef: edge.targetDef,
          apiSlug: DEFS[edge.targetDef]!.apiSlug,
          label: DEFS[edge.targetDef]!.singular,
          records: 0,
          edges: 0,
          itemIds: new Set(),
        }
        groups.set(key, g)
      }
      g.edges += 1
      g.itemIds.add(item.id)
    }
  }
  return [...groups.values()]
    .map(({ itemIds, ...g }) => ({ ...g, records: itemIds.size }))
    .sort((a, b) => b.edges - a.edges)
}

const updateChain = {
  set: () => updateChain,
  where: () => updateChain,
  returning: async () => [],
}

const db = {
  query: {
    DataConnector: {
      findFirst: async () => world.connector,
      // `sweepStrandedConnectors` (task 43 D-3) runs at chain start. Faithful rather
      // than stubbed empty: it only ever sees a connector left `syncing` by this world.
      findMany: async () => (world.connector.status === 'syncing' ? [world.connector] : []),
    },
    DataConnectorRun: {
      findFirst: async ({ where }: { where: unknown }) => {
        const ids = paramValues(where)
        return world.runs.find((r) => ids.includes(r.id)) ?? null
      },
      findMany: async ({ where }: { where: unknown }) => {
        const params = paramValues(where)
        const since = params.find((p): p is Date => p instanceof Date)
        return world.runs
          .filter((r) => params.includes(r.dataConnectorId))
          .filter((r) => (since ? r.startedAt.getTime() >= since.getTime() : true))
          .map((r) => ({ id: r.id }))
      },
    },
    DataConnectorStream: {
      findFirst: async ({ where }: { where: unknown }) => {
        const ids = paramValues(where)
        return [...world.streams.values()].find((s) => ids.includes(s.id)) ?? null
      },
      findMany: async ({ where }: { where: unknown }) => {
        const ids = paramValues(where)
        return [...world.streams.values()].filter((s) => ids.includes(s.id))
      },
    },
  },
  update: () => updateChain,
  execute: async () => ({ rows: aggregatePendingLinks() }),
}

function mapping(streamKey: 'customers' | 'orders') {
  return {
    row: { id: `m-${streamKey}` },
    rootPath: '$',
    linkMode: 'upsert',
    targetMode: 'owned',
    entityDefinitionId: DEF_BY_STREAM[streamKey],
    parentMappingId: null,
    relationshipFieldKey: null,
    orphanBehavior: 'archive',
    fieldMappings: [],
  }
}

// ── Seams ───────────────────────────────────────────────────────────────────────

vi.mock('./service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./service')>()
  return {
    ...actual,
    loadConnector: async () => ({
      connector: world.connector,
      streams: [...world.streams.values()].map((s) => ({
        stream: s,
        syncMode: s.syncMode,
        mappings: [mapping(s.streamKey as 'customers' | 'orders')],
      })),
    }),
    claimForSync: async () => true,
    initConnectorBackfillLatch: async (_db: unknown, _id: string, n: number) => {
      world.latch = n
    },
    decrementConnectorBackfillLatch: async () => {
      if (world.latch === null) return null
      world.latch = Math.max(world.latch - 1, 0)
      return world.latch
    },
    openRun: async (_db: unknown, input: { trigger: string; phase?: 'backfill' | 'steady' }) => {
      const run: FakeRun = {
        id: `run${++world.runSeq}`,
        dataConnectorId: 'dc1',
        status: 'running',
        phase: input.phase ?? null,
        trigger: input.trigger,
        chainSnapshot: (input as { chainSnapshot?: Record<string, unknown> }).chainSnapshot ?? null,
        startedAt: new Date(),
        sampleLimit: null,
        fetched: 0,
      }
      world.runs.push(run)
      return run
    },
    persistStreamState: async (_db: unknown, streamId: string, state: ConnectorStreamState) => {
      const s = world.streams.get(streamId)
      if (s) s.state = state
    },
    getRunFetched: async (_db: unknown, runId: string) => currentRun(runId)?.fetched ?? 0,
    parkBackfillAtCeiling: async (_db: unknown, input: { runId: string }) => {
      const run = currentRun(input.runId)
      if (run) run.status = 'partial'
      world.connector.status = 'paused'
      world.parkedAtCeiling.push(input.runId)
    },
    finalizeConnector: async (_db: unknown, _id: string, input: { ok: boolean }) => {
      world.connector.status = input.ok ? 'live' : 'error'
      world.finalized.push(input)
    },
    countConnectorItems: async () => world.items.size,
    clearResyncPending: async () => {},
    foldRunManifest: async () => {},
    markRunManifestDegraded: async () => {},
    getRunManifest: async () => null,
    publishSyncRecordsChanged: async () => {},
    setRunRateLimited: async () => {},
    parkConnectorSampleIfLastStream: async () => {},
    // The relationship pass's reads and writes, over the in-memory items.
    listItemsWithPendingRelations: async () =>
      [...world.items.values()].filter(
        (i) => (i.pendingRelations?.length ?? 0) > 0
      ) as unknown as DataConnectorItemRow[],
    findItemByDef: async (_db: unknown, _dc: string, def: string, externalId: string) =>
      (world.items.get(itemKey(def, externalId)) ?? null) as unknown as DataConnectorItemRow | null,
    readRelationshipTargets: async () => new Map<string, string>(),
    setItemRelationState: async (
      _db: unknown,
      itemId: string,
      state: { pendingRelations: PendingRelation[]; linkedRelations: string[] }
    ) => {
      const item = [...world.items.values()].find((i) => i.id === itemId)
      if (!item) return
      item.pendingRelations = state.pendingRelations.length > 0 ? state.pendingRelations : null
      item.linkedRelations = state.linkedRelations.length > 0 ? state.linkedRelations : null
    },
  }
})

vi.mock('./sync-core-adapters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./sync-core-adapters')>()
  return {
    ...actual,
    createStreamSyncStateStore: (_db: unknown, streamId: string): SyncStateStore => ({
      load: async () => actual.syncStateFromStream(world.streams.get(streamId)?.state ?? {}),
      save: async (sync: SyncState) => {
        const s = world.streams.get(streamId)
        if (s) s.state = actual.applySyncStateToStream(s.state, sync)
      },
    }),
    createConnectorRunLedger: (_db: unknown, run: { id: string }) => ({
      recordSlice: async (entry: {
        counters?: { fetched?: number; relationshipWarnings?: number }
      }) => {
        const r = currentRun(run.id)
        if (r) r.fetched += entry.counters?.fetched ?? 0
        world.ledgerFolds.push({
          runId: run.id,
          relationshipWarnings: entry.counters?.relationshipWarnings ?? 0,
        })
      },
      finalize: async () => {
        const r = currentRun(run.id)
        if (r) r.status = 'completed'
      },
      fail: async () => {
        const r = currentRun(run.id)
        if (r) r.status = 'failed'
      },
    }),
  }
})

vi.mock('./data-connector-queue', () => ({
  enqueueBackfillSlice: async (data: { streamId: string; runId: string }) => {
    world.sliceQueue.push({ streamId: data.streamId, runId: data.runId })
  },
  enqueueConnectorSync: async () => {},
}))

vi.mock('./realtime', () => ({ publishConnectorSync: async () => {} }))
vi.mock('../realtime', () => ({
  getRealtimeService: () => ({}),
  publishRecordsInvalidated: async () => {},
  publishRunCompleted: async () => {},
}))
vi.mock('./provisioning', () => ({ materializeConnectorTargets: async () => {} }))
vi.mock('../apps/installations/app-field-provisioning', () => ({
  reconcileInstallationAppFields: async () => ({ errors: [] }),
}))
vi.mock('../agents/bindings/resolve', () => ({
  resolveConnectorFieldRef: async () => 'resolved',
}))
vi.mock('../sync-core/throttle', () => ({
  createThrottleHandle: () => ({ run: (fn: () => unknown) => fn() }),
}))
// Every handler the source builds is this class; only the relationship pass writes
// through it here (the sink below is a fake), so `update` records the link writes.
vi.mock('../resources/crud/unified-handler', () => ({
  UnifiedCrudHandler: class {
    async warmCache() {}
    async update(recordId: string, values: Record<string, unknown>) {
      const runId = world.runs.at(-1)?.id ?? ''
      world.linkWrites.push({ recordId, values, runStatus: currentRun(runId)?.status })
      return {}
    }
  },
}))
vi.mock('../record-rules/sync-manifest-collector', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../record-rules/sync-manifest-collector')>()
  return { ...actual, loadManifestCollector: async () => actual.createManifestCollector({}) }
})
vi.mock('./field-id-resolver', () => ({
  buildWriteKeyToFieldId: async () =>
    new Map([
      ['customer', 'fld-customer'],
      ['related_order', 'fld-related-order'],
    ]),
}))
vi.mock('./reconciliation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./reconciliation')>()
  return { ...actual, reconcileManagedMarkers: async () => {} }
})
vi.mock('./sinks/entity-sink', () => ({
  entitySink: {
    listExistingItems: async () => [],
    archiveRecord: async () => {},
  },
}))

/**
 * The sink: bind every fetched record to an item (one per def + external id) and queue
 * the record's edges the way `mergePending` would on first sight. A record seen again
 * (the resumed run re-crawls `customers`) is a touch, nothing re-queued.
 */
vi.mock('./sink-source-record', () => ({
  sinkSourceRecord: async (
    ctx: { counters: { fetched: number } },
    _mappings: unknown,
    record: { streamKey: string; fields: { id: string }; pendingRelations?: PendingRelation[] }
  ) => {
    ctx.counters.fetched += 1
    const def = DEF_BY_STREAM[record.streamKey]!
    const key = itemKey(def, record.fields.id)
    if (world.items.has(key)) return
    world.items.set(key, {
      id: `i-${record.fields.id}`,
      entityDefinitionId: def,
      entityInstanceId: `e-${record.fields.id}`,
      externalId: record.fields.id,
      pendingRelations: record.pendingRelations ?? null,
      linkedRelations: null,
      archivedAt: null,
    })
  },
}))

const LAST_ORDER = `o-${ORDER_PAGES}-0`

/**
 * The fixture connector. `customers` is one page of CUSTOMERS records; `orders` pages
 * 1..ORDER_PAGES from the cursor. The first order of each page carries an edge to a
 * customer and one to the first order of the last page.
 */
function fixtureDefinition(): DataConnectorDefinition {
  return {
    type: 'fixture',
    schemaVersion: 1,
    requestModel: 'fixed',
    streams: [],
    fetch: async (args) => {
      const from = args.state.backfillCursor ? Number(args.state.backfillCursor.value) : 1
      async function* customers() {
        for (let i = 0; i < CUSTOMERS; i++) {
          yield { streamKey: 'customers', fields: { id: `c-${i}` } }
        }
        yield { __checkpoint: true as const, cursor: undefined }
      }
      async function* orders() {
        for (let page = from; page <= ORDER_PAGES; page++) {
          for (let i = 0; i < PAGE_SIZE; i++) {
            const id = `o-${page}-${i}`
            const pendingRelations: PendingRelation[] | undefined =
              i === 0
                ? [
                    {
                      fieldKey: 'customer',
                      targetDef: 'def-customers',
                      targetExternalId: `c-${page % CUSTOMERS}`,
                    },
                    {
                      fieldKey: 'related_order',
                      targetDef: 'def-orders',
                      targetExternalId: LAST_ORDER,
                    },
                  ]
                : undefined
            yield { streamKey: 'orders', fields: { id }, pendingRelations }
          }
          yield {
            __checkpoint: true as const,
            cursor:
              page < ORDER_PAGES
                ? { kind: 'pageNumber' as const, value: String(page + 1) }
                : undefined,
          }
        }
      }
      return { records: args.streamKey === 'customers' ? customers() : orders(), nextState: {} }
    },
  }
}
vi.mock('./connector-runtime', () => ({
  prepareConnectorFetch: async () => ({ definition: fixtureDefinition(), credential: null }),
}))

import { countPendingRelationsByTarget } from './service'
import { runBackfillSlice, startConnectorSync } from './slice-orchestrator'

const DB = db as never

/** Run every queued slice until the queue drains (the worker re-invoking the chain). */
async function drainSlices(): Promise<void> {
  while (world.sliceQueue.length > 0) {
    const job = world.sliceQueue.shift()!
    await runBackfillSlice(DB, {
      connectorId: 'dc1',
      organizationId: 'org1',
      streamId: job.streamId,
      runId: job.runId,
    })
  }
}

async function pendingLinks(): Promise<PendingRelationTargetCount[]> {
  return (await countPendingRelationsByTarget(DB, 'org1', 'dc1'))._unsafeUnwrap()
}

/** Orders whose first-of-page edges were queued: pages 1..N synced so far. */
function firstOrders(pages: number) {
  return Array.from({ length: pages }, (_, p) => `o-${p + 1}-0`)
}

beforeEach(() => {
  resetWorld()
})

describe('relationship pass at the ingest-ceiling park (§3.6)', () => {
  it('links stream A edges at the park, leaves B-dependent edges pending, and the count reports them by target', async () => {
    await startConnectorSync(DB, 'org1', 'dc1', { trigger: 'manual' })
    await drainSlices()

    // Stream A completed and deferred the finalize; stream B parked at the ceiling
    // after 20 pages.
    expect(world.parkedAtCeiling).toEqual(['run1'])
    expect(world.runs[0]?.status).toBe('partial')
    expect(world.latch).toBe(1)
    expect(world.streams.get('s-customers')?.state.phase).toBe('steady')
    expect(world.streams.get('s-orders')?.state.backfillCursor).toEqual({
      kind: 'pageNumber',
      value: '21',
    })

    // The 20 customer edges were written, each while the run was still running (the
    // pass precedes the park), through the crud handler with the RecordId shapes the
    // finalize would write.
    expect(world.linkWrites).toHaveLength(20)
    expect(world.linkWrites.every((w) => w.runStatus === 'running')).toBe(true)
    expect(world.linkWrites.map((w) => w.recordId)).toEqual(
      firstOrders(20).map((id) => `def-orders:e-${id}`)
    )
    expect(world.linkWrites[0]?.values).toEqual({ customer: 'def-customers:e-c-1' })

    // The related_order edges point at page 25, which the park never reached: still
    // pending on every one of the 20 items, and counted as warnings in the fold.
    for (const id of firstOrders(20)) {
      const item = world.items.get(itemKey('def-orders', id))
      expect(item?.pendingRelations).toEqual([
        { fieldKey: 'related_order', targetDef: 'def-orders', targetExternalId: LAST_ORDER },
      ])
      expect(item?.linkedRelations).toEqual(['customer'])
    }
    const parkFold = world.ledgerFolds.find((f) => f.relationshipWarnings > 0)
    expect(parkFold).toEqual({ runId: 'run1', relationshipWarnings: 20 })

    expect(await pendingLinks()).toEqual([
      {
        sourceDef: 'def-orders',
        sourceLabel: 'Order',
        targetDef: 'def-orders',
        apiSlug: 'order',
        label: 'Order',
        records: 20,
        edges: 20,
      },
    ])
  })

  it('the resumed run finalize resolves the rest and the count reads zero', async () => {
    await startConnectorSync(DB, 'org1', 'dc1', { trigger: 'manual' })
    await drainSlices()
    expect((await pendingLinks())[0]?.edges).toBe(20)
    const writesAtPark = world.linkWrites.length

    await startConnectorSync(DB, 'org1', 'dc1', { trigger: 'manual' })
    await drainSlices()

    // Run 2 crawled pages 21..25 and closed through the connector-level finalize.
    expect(world.runs[1]?.status).toBe('completed')
    expect(world.connector.status).toBe('live')
    expect(world.finalized.map((f) => f.ok)).toEqual([true])
    expect(world.streams.get('s-orders')?.state.phase).toBe('steady')

    // The finalize wrote the 20 related_order edges that waited on page 25, plus both
    // edges of the 5 first-of-page orders pages 21..25 queued, and nothing was written
    // twice: the 20 customer edges consumed at the park are gone from
    // pendingRelations, so the pass never saw them again.
    const finalizeWrites = world.linkWrites.slice(writesAtPark)
    expect(finalizeWrites).toHaveLength(30)
    expect(finalizeWrites.filter((w) => 'related_order' in w.values)).toHaveLength(25)
    expect(finalizeWrites.filter((w) => 'customer' in w.values)).toHaveLength(5)
    expect(
      finalizeWrites
        .filter((w) => 'related_order' in w.values)
        .every((w) => w.values.related_order === `def-orders:e-${LAST_ORDER}`)
    ).toBe(true)

    for (const item of world.items.values()) expect(item.pendingRelations).toBeNull()
    expect(await pendingLinks()).toEqual([])
  })
})
