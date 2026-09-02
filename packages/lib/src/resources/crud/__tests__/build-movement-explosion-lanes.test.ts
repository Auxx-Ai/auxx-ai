// packages/lib/src/resources/crud/__tests__/build-movement-explosion-lanes.test.ts
//
// plans/products/build/01-build-plan.md §3.5 trap 2, settled with a real test.
//
// The question: `completeBuild` writes ~51 `stock_movement` rows in one
// transaction, every one carrying `adjustSubparts: false`, and must not
// re-explode its own BOM. Suppression has TWO independent seams and the plan
// treats them as one:
//
//   1. the per-write fan-out (`derivePublishEvents`) — the bus event that
//      reaches `handleRecordRules` → `fireRecordRulesBatch` → the native
//      `explodeBomMovement` handler;
//   2. the sync-manifest collector (`syncCollectorOf`) — fed at the mutation
//      seam INDEPENDENTLY of `publishEvents`, whose consumer
//      (`handleSyncRecordRules`) dispatches the very same native rule.
//
// These tests pin both, per candidate lane, and pin the trigger's own
// `adjustSubparts` guard so the flag's contribution can be told apart from the
// lane's.
//
// @auxx/database is globally mocked in src/test/setup.ts; the mutation-seam
// mocks mirror `sync-lifecycle-capture.test.ts` (spread-preserving where the
// module has more exports).

import { ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  // ── createEntity seam ──
  deleteOpenPairsForRecord: vi.fn(async () => ok(0)),
  enqueueDuplicateScan: vi.fn(async () => 'job_1'),
  publish: vi.fn(async () => {}),
  publishLater: vi.fn(() => {}),
  deleteCommentsByRecordId: vi.fn(async () => {}),
  // ── sync-manifest consumer seam ──
  getRunManifest: vi.fn(async () => null as unknown),
  claimRunManifestConsumed: vi.fn(async () => true),
  getImportManifest: vi.fn(async () => null as unknown),
  claimImportManifestConsumed: vi.fn(async () => true),
  getCachedRecordRules: vi.fn(async () => [] as unknown[]),
  fetchResourceSnapshots: vi.fn(async () => new Map()),
  runSyncFinalize: vi.fn(async () => {}),
  insertRecordRuleRuns: vi.fn(async () => {}),
  insertRecordRuleRun: vi.fn(async () => {}),
  // ── native rule handlers ──
  explodeBomMovement: vi.fn(async (_event: unknown) => {}),
  recalculatePartQoH: vi.fn(async () => {}),
  recalculatePurchaseOrderLineReceived: vi.fn(async () => {}),
  recalculatePurchaseOrderLineBilled: vi.fn(async () => {}),
  loadSubpartGraph: vi.fn(async () => new Map()),
}))

vi.mock('../../../dedup/pairs', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  deleteOpenPairsForRecord: h.deleteOpenPairsForRecord,
}))
vi.mock('../../../dedup/enqueue-scan', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  enqueueDuplicateScan: h.enqueueDuplicateScan,
}))
vi.mock('../../../entity-instances', () => ({
  getEntityInstance: vi.fn(async () => ok({ id: 'sm_1', archivedAt: null })),
  updateEntityInstance: vi.fn(async () => ok({ id: 'sm_1' })),
  createEntityInstance: vi.fn(async () => ok({ id: 'sm_1' })),
  deleteEntityInstance: vi.fn(async () => ok({ id: 'sm_1' })),
}))
vi.mock('../../../realtime', () => ({
  getRealtimeService: () => ({ publish: h.publish }),
  publishRecordsChanged: vi.fn(async () => {}),
  rooms: { orgRecords: () => 'room' },
}))
vi.mock('../../../events/publisher', () => ({
  publisher: { publishLater: h.publishLater, publish: h.publishLater },
}))
vi.mock('../../../comments', () => ({
  CommentService: class {
    deleteCommentsByRecordId = h.deleteCommentsByRecordId
  },
}))
vi.mock('../../../cache', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  findCachedResource: vi.fn(async () => undefined),
  getCachedRecordRules: h.getCachedRecordRules,
  getCachedResourceFields: vi.fn(async () => []),
}))
vi.mock('../../../data-connectors/service', () => ({
  getRunManifest: h.getRunManifest,
  claimRunManifestConsumed: h.claimRunManifestConsumed,
}))
vi.mock('../../../import', () => ({
  getImportManifest: h.getImportManifest,
  claimImportManifestConsumed: h.claimImportManifestConsumed,
}))
vi.mock('../../../events/handlers/sync-finalize', () => ({
  runSyncFinalize: h.runSyncFinalize,
}))
vi.mock('../../../record-rules/store', () => ({
  insertRecordRuleRun: h.insertRecordRuleRun,
  insertRecordRuleRuns: h.insertRecordRuleRuns,
}))
vi.mock('../../../record-rules/snapshot-fetcher', () => ({
  fetchResourceSnapshots: h.fetchResourceSnapshots,
}))
vi.mock('../../../field-hooks/post/bom-movement-triggers', () => ({
  explodeBomMovement: h.explodeBomMovement,
}))
vi.mock('../../../field-hooks/post/inventory-triggers', () => ({
  recalculatePartQoH: h.recalculatePartQoH,
}))
// Partial, not wholesale: `createEntity` now reads the hook registry for
// entity pre-create hooks, and that read calls `ensureInitialized` ->
// `registerAllHooks`, which imports this module's OTHER exports. A bare factory
// mock drops them and the create path fails on the missing name rather than on
// anything this file is testing.
vi.mock('../../../field-hooks/post/purchase-order-line-rollups', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  recalculatePurchaseOrderLineReceived: h.recalculatePurchaseOrderLineReceived,
  recalculatePurchaseOrderLineBilled: h.recalculatePurchaseOrderLineBilled,
}))
vi.mock('../../../bom/subpart-graph', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadSubpartGraph: h.loadSubpartGraph,
}))

import { database } from '@auxx/database'
import { type RecordId, toRecordId } from '@auxx/types/resource'
import { handleSyncRecordRules } from '../../../events/handlers/handle-sync-record-rules'
import { registerEntitySystemRules } from '../../../field-hooks/system-entity-rules'
import type { EntityTriggerEvent } from '../../../field-hooks/types'
import { getSyncRuleSubscriptions } from '../../../record-rules/subscriptions'
import {
  createManifestCollector,
  type ManifestCollector,
} from '../../../record-rules/sync-manifest-collector'
import type { SyncChangeManifest } from '../../../record-rules/sync-manifest-types'
import { getSystemRuleDeclarations, resolveSystemRules } from '../../../record-rules/system-rules'
import type { CachedRecordRule } from '../../../record-rules/types'
import { createEntity, type MutationContext } from '../unified-handler-mutations'
import { interactiveSession, quietSession, seedSession, type WriteSession } from '../write-origin'

const ORG = 'org_1'
const MOVEMENT_DEF = 'def_stock_movement'
const PART_DEF = 'def_part'
const MOVEMENT_RID = toRecordId(MOVEMENT_DEF, 'sm_1')

/**
 * One `build_consume` row exactly as §3.4 step 4 specifies it: the explosion
 * flag is OFF, because the build does its own explosion.
 */
const BUILD_CONSUME_VALUES: Record<string, unknown> = {
  stock_movement_part: toRecordId(PART_DEF, 'part_1'),
  stock_movement_type: 'build_consume',
  stock_movement_quantity: -4,
  stock_movement_adjust_subparts: false,
}

/** Minimal CustomField-shaped rows for the create path's field plumbing. */
const MOVEMENT_FIELDS = [
  'stock_movement_part',
  'stock_movement_type',
  'stock_movement_quantity',
  'stock_movement_adjust_subparts',
].map((systemAttribute) => ({
  id: `fld_${systemAttribute}`,
  name: systemAttribute,
  systemAttribute,
  required: false,
  isCreatable: true,
}))

/**
 * The REAL `stock-movements` system rules, resolved for an org that has the def.
 * Every other declaration drops out because its def slug is unknown here — so
 * what these tests dispatch is the shipped `mfg-stock-movements-created`
 * declaration, native actions and action order included, not a fixture of it.
 */
function stockMovementSystemRules(): CachedRecordRule[] {
  registerEntitySystemRules()
  return resolveSystemRules(ORG, getSystemRuleDeclarations(), {
    defIdBySlug: (slug) => (slug === 'stock-movements' ? MOVEMENT_DEF : undefined),
    fieldIdBySystemAttribute: () => undefined,
  })
}

/** A sync session whose collector is built from the real rule subscriptions. */
function syncSession(collector: ManifestCollector): WriteSession {
  return { origin: { kind: 'sync', source: 'retro', ref: 'build_1', collector }, depth: 0 }
}

function collectorForStockMovements(): ManifestCollector {
  return createManifestCollector(getSyncRuleSubscriptions(stockMovementSystemRules()))
}

function ctx(session: WriteSession): MutationContext {
  return {
    db: {} as never,
    organizationId: ORG,
    userId: 'user_1',
    session,
    fieldValueService: {} as never,
    resolveEntityDefinition: async () => ({
      id: MOVEMENT_DEF,
      entityType: 'stock_movement',
      apiSlug: 'stock-movements',
    }),
    getFields: async () => MOVEMENT_FIELDS as never,
    runPreHooks: async (_o, _d, values) => values,
    validateUniqueFields: async () => {},
    setFieldValues: async () => [],
  }
}

function manifest(over: Partial<SyncChangeManifest> = {}): SyncChangeManifest {
  return {
    version: 2,
    detailTruncated: false,
    membershipTruncated: false,
    touched: {},
    deltas: {},
    createdRecordIds: [],
    archivedRecordIds: [],
    ...over,
  } as SyncChangeManifest
}

function connectorEvent() {
  return {
    data: {
      type: 'sync:records:changed',
      data: { source: 'connector', organizationId: ORG, ref: 'run_1' },
    },
  } as never
}

beforeEach(() => {
  vi.clearAllMocks()
  h.claimRunManifestConsumed.mockResolvedValue(true)
  h.getCachedRecordRules.mockResolvedValue([])
})

// ───────────────────────────────────────────────────────────────────────────
// Seam 1: which lanes feed the sync-manifest collector
// ───────────────────────────────────────────────────────────────────────────

describe('trap 2 seam 1 — does the write reach the sync-manifest collector?', () => {
  it('interactive lane: no collector exists, but the per-write door DOES fire', async () => {
    await createEntity(ctx(interactiveSession('user_1')), MOVEMENT_DEF, {
      ...BUILD_CONSUME_VALUES,
    })

    // The inline door is the OTHER route to explodeBomMovement — the bus event
    // this publishes is what `handleRecordRules` consumes.
    expect(h.publishLater).toHaveBeenCalled()
  })

  it('sync lane: the create IS captured, with adjustSubparts:false in createdValues', async () => {
    const collector = collectorForStockMovements()

    await createEntity(ctx(syncSession(collector)), MOVEMENT_DEF, { ...BUILD_CONSUME_VALUES })

    const captured = collector.toJson()
    expect(captured?.createdRecordIds).toEqual([MOVEMENT_RID])
    expect(captured?.createdValues?.[MOVEMENT_RID]).toMatchObject({
      stock_movement_adjust_subparts: false,
      stock_movement_type: 'build_consume',
    })
    // The per-write door is shut — but capture is not a door.
    expect(h.publishLater).not.toHaveBeenCalled()
    expect(h.publish).not.toHaveBeenCalled()
  })

  it('sync lane + skipEvents:true STILL captures — the deprecated alias does not reach the collector', async () => {
    const collector = collectorForStockMovements()

    await createEntity(
      ctx(syncSession(collector)),
      MOVEMENT_DEF,
      { ...BUILD_CONSUME_VALUES },
      { skipEvents: true }
    )

    // This is the trap: `skipEvents` gates `derivePublishEvents` only. The
    // collector feed at the mutation seam is unconditional for a sync origin.
    expect(collector.toJson()?.createdRecordIds).toEqual([MOVEMENT_RID])
    expect(h.publishLater).not.toHaveBeenCalled()
  })

  it('seed lane: no door and no collector — a seed origin carries none by construction', async () => {
    const session = seedSession('build completion posts its own ledger')

    await createEntity(ctx(session), MOVEMENT_DEF, { ...BUILD_CONSUME_VALUES })

    expect(session.origin.kind).toBe('seed')
    expect('collector' in session.origin).toBe(false)
    expect(h.publishLater).not.toHaveBeenCalled()
    expect(h.publish).not.toHaveBeenCalled()
  })

  it('quiet automation lane: no door and no collector either', async () => {
    const session = quietSession('build completion posts its own ledger')

    await createEntity(ctx(session), MOVEMENT_DEF, { ...BUILD_CONSUME_VALUES })

    expect(session.origin.kind).toBe('automation')
    expect('collector' in session.origin).toBe(false)
    expect(h.publishLater).not.toHaveBeenCalled()
    expect(h.publish).not.toHaveBeenCalled()
  })
})

// ───────────────────────────────────────────────────────────────────────────
// Seam 2: what the manifest consumer does with a captured create
// ───────────────────────────────────────────────────────────────────────────

describe('trap 2 seam 2 — a captured create re-dispatches the native BOM rule', () => {
  it('dispatches explodeBomMovement, with the raw adjustSubparts:false values threaded', async () => {
    h.getCachedRecordRules.mockResolvedValue(stockMovementSystemRules())
    h.getRunManifest.mockResolvedValue(
      manifest({
        createdRecordIds: [MOVEMENT_RID],
        createdValues: { [MOVEMENT_RID]: { ...BUILD_CONSUME_VALUES } } as Record<
          RecordId,
          Record<string, unknown>
        >,
      })
    )

    await handleSyncRecordRules(connectorEvent())

    // Reachable. The manifest lane is a full second door onto the trigger —
    // suppressing the bus event does not close it.
    expect(h.explodeBomMovement).toHaveBeenCalledTimes(1)
    const event = h.explodeBomMovement.mock.calls[0]![0] as EntityTriggerEvent
    expect(event.action).toBe('created')
    expect(event.entityInstanceId).toBe('sm_1')
    expect(event.values.stock_movement_adjust_subparts).toBe(false)
    // Same firing carries the QoH recalc — the other half of trap 1.
    expect(h.recalculatePartQoH).toHaveBeenCalledTimes(1)
  })

  it('captures nothing, dispatches nothing: an empty manifest never reaches the trigger', async () => {
    h.getCachedRecordRules.mockResolvedValue(stockMovementSystemRules())
    h.getRunManifest.mockResolvedValue(manifest())

    await handleSyncRecordRules(connectorEvent())

    expect(h.explodeBomMovement).not.toHaveBeenCalled()
    expect(h.recalculatePartQoH).not.toHaveBeenCalled()
  })
})

// ───────────────────────────────────────────────────────────────────────────
// The belt: the trigger's own guard, independent of any lane
// ───────────────────────────────────────────────────────────────────────────

describe('trap 4 — explodeBomMovement guards on adjustSubparts itself', () => {
  async function realExplode() {
    const actual = await vi.importActual<
      typeof import('../../../field-hooks/post/bom-movement-triggers')
    >('../../../field-hooks/post/bom-movement-triggers')
    return actual.explodeBomMovement
  }

  function triggerEvent(values: Record<string, unknown>): EntityTriggerEvent {
    return {
      action: 'created',
      entitySlug: 'stock-movements',
      entityType: '',
      entityDefinitionId: MOVEMENT_DEF,
      entityInstanceId: 'sm_1',
      organizationId: ORG,
      userId: 'user_1',
      values,
    }
  }

  it('returns before touching the subpart graph or the DB when the flag is false', async () => {
    const explode = await realExplode()

    await explode(triggerEvent({ ...BUILD_CONSUME_VALUES }))

    expect(h.loadSubpartGraph).not.toHaveBeenCalled()
    expect(database.insert).not.toHaveBeenCalled()
  })

  it('returns the same way when the flag is absent entirely', async () => {
    const explode = await realExplode()
    const { stock_movement_adjust_subparts: _omitted, ...withoutFlag } = BUILD_CONSUME_VALUES

    await explode(triggerEvent(withoutFlag))

    expect(h.loadSubpartGraph).not.toHaveBeenCalled()
    expect(database.insert).not.toHaveBeenCalled()
  })

  it('proceeds past the guard when the flag IS true (the guard is not a no-op)', async () => {
    const explode = await realExplode()
    h.loadSubpartGraph.mockRejectedValueOnce(new Error('reached loadSubpartGraph'))

    await expect(
      explode(triggerEvent({ ...BUILD_CONSUME_VALUES, stock_movement_adjust_subparts: true }))
    ).rejects.toThrow('reached loadSubpartGraph')
  })
})
