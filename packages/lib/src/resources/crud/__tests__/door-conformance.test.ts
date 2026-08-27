// packages/lib/src/resources/crud/__tests__/door-conformance.test.ts
//
// DOOR-MATRIX CONFORMANCE HARNESS (plan 03 §5/§6).
//
// `door-matrix.test.ts` asserts the matrix's cells EXIST; this file asserts the
// cells observable at the handler seam are TRUE. It drives a real
// `UnifiedCrudHandler` (same mocked db/services approach as
// `write-session.test.ts` / `archive-duplicate-pair-cleanup.test.ts`) through
// create / update / archive once per write-origin kind, records which doors
// actually fired, and then checks the observations AGAINST `DOOR_MATRIX`
// programmatically — the loop iterates the matrix entries, so a future cell
// edit that the implementation does not honor fails here, without anyone
// hand-writing the new expectation.
//
// Three conformance states, and the harness knows the difference:
//   - "verified here"      — doors with an observation point at this seam
//                            (`DOOR_CONFORMANCE[door].kind === 'observed'`).
//   - "verified elsewhere" — doors whose truth-point is another layer
//                            (field hooks, field-value service, entity-instances,
//                            org-cache); listed as `deferred` with the home named,
//                            and surfaced as skipped tests so the split is visible.
//   - "unverifiable"       — doors whose machinery does not exist yet (tier-2
//                            frames, the finalize pipeline); `deferred` with a
//                            plan reference instead of a test-suite home.
//
// THE MATRIX IS DESIRED BEHAVIOR, NOT CURRENT BEHAVIOR. Where they differ
// today, the mismatch is encoded — never papered over — in `KNOWN_DEVIATIONS`
// below, each entry carrying the plan reference for the phase that closes it.
// A deviation that stops deviating fails its test, forcing the entry's removal.
//
// A fourth, per-CELL state exists since the sync finalize pass merged
// (`events/handlers/sync-finalize.ts`): a door observed at THIS seam for most
// origins can have individual (door, origin) cells whose truth-point is the
// finalize seam instead — the handler stays silent BY DESIGN and finalize
// executes the door off the claimed manifest. Those cells live in
// `VERIFIED_ELSEWHERE_CELLS`, enforced both ways like the deviations: the
// conformance loop skips them, and a dedicated test asserts the seam is STILL
// silent (inline firing would double-execute the door against finalize).

import { ok } from 'neverthrow'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import {
  DOOR_MATRIX,
  type DoorId,
  type DoorPolicy,
  WRITE_ORIGIN_KINDS,
  type WriteOriginKind,
} from '../door-matrix'

const h = vi.hoisted(() => {
  // One creatable, non-required, non-unique field so the write paths exercise
  // defaults / required-check / pre-hooks / unique-check / setFieldValues
  // without needing a real FieldValueService write underneath.
  const FIELD = {
    id: 'field_first_name',
    name: 'First Name',
    systemAttribute: 'first_name',
    required: false,
    isCreatable: true,
    isUnique: false,
  }
  const state = { fields: [FIELD] as (typeof FIELD)[] }
  return {
    FIELD,
    state,
    // Door observation points
    publishLater: vi.fn(() => {}), // bus event (timeline / rules / workflows / notifications proxy)
    // realtime tier-1 record frames — arg-typed so `mock.calls[n][1]` is legal
    // for tsc (an untyped vi.fn() types calls as an empty tuple, TS2493).
    publish: vi.fn<(room: unknown, event: string, data?: unknown) => Promise<void>>(async () => {}),
    enqueueDuplicateScan: vi.fn(async () => 'job_1'), // dedup scan door
    deleteOpenPairsForRecord: vi.fn(async () => ok(0)), // pair cleanup (outside the guard)
    preHook: vi.fn(async (hookCtx: { values: Record<string, unknown> }) => hookCtx.values),
    // Entity-instance row seam (archive path row write = the D-7 stamp site)
    getEntityInstance: vi.fn(async () =>
      ok({ id: 'inst_1', archivedAt: null, entityDefinitionId: 'def_1' })
    ),
    createEntityInstance: vi.fn(async () => ok({ id: 'inst_1' })),
    updateEntityInstance: vi.fn(async () => ok({ id: 'inst_1' })),
    deleteEntityInstance: vi.fn(async () => ok({ id: 'inst_1' })),
    listEntityInstances: vi.fn(async () => ok({ items: [] })),
    findCachedResource: vi.fn(async () => ({
      id: 'def_1',
      entityDefinitionId: 'def_1',
      entityType: 'contact',
      apiSlug: 'contacts',
      fields: [],
    })),
    getCachedCustomFields: vi.fn(async () => state.fields),
  }
})

vi.mock('../../../dedup/pairs', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  deleteOpenPairsForRecord: h.deleteOpenPairsForRecord,
}))
vi.mock('../../../dedup/enqueue-scan', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  enqueueDuplicateScan: h.enqueueDuplicateScan,
}))
vi.mock('../../../entity-instances', () => ({
  getEntityInstance: h.getEntityInstance,
  updateEntityInstance: h.updateEntityInstance,
  createEntityInstance: h.createEntityInstance,
  deleteEntityInstance: h.deleteEntityInstance,
  listEntityInstances: h.listEntityInstances,
}))
vi.mock('../../../realtime', () => ({
  getRealtimeService: () => ({ publish: h.publish }),
  rooms: { orgRecords: () => 'room' },
}))
vi.mock('../../../events/publisher', () => ({
  publisher: { publishLater: h.publishLater, publish: h.publishLater },
}))
vi.mock('../../../cache', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  findCachedResource: h.findCachedResource,
  getCachedCustomFields: h.getCachedCustomFields,
}))
// Pre-hook observation: one spy hook on the field above, so "pre-hooks ran"
// is observable per origin. Partial mock — the module has more exports.
vi.mock('../../hooks', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getSystemHooks: () => ({ first_name: [h.preHook] }),
  getCommonHooks: () => ({}),
}))

import { createManifestCollector } from '../../../record-rules/sync-manifest-collector'
import type { RecordId } from '../../resource-id'
import { UnifiedCrudHandler } from '../unified-handler'
import type { CrudOptions } from '../unified-handler-mutations'
import { interactiveSession, seedSession, type WriteSession } from '../write-origin'
import { runWithWriteSession } from '../write-session-als'

// ═══════════════════════════════════════════════════════════════════════════
// OBSERVATION RECORDER
// ═══════════════════════════════════════════════════════════════════════════

type Op = 'create' | 'update' | 'archive'

/** What each low-level observation channel recorded for one operation. */
interface OpObservation {
  /** `publishEvent` → `publisher.publishLater` — the bus event every inline
   *  consumer (timeline entry, record rules, workflow dispatch, notifications)
   *  hangs off. */
  busEvent: boolean
  /** Realtime tier-1 per-record frame (`record:created|updated|archived`). */
  recordFrame: boolean
  /** `enqueueDuplicateScan` — the dedup scan door. */
  dedupEnqueue: boolean
  /** `deleteOpenPairsForRecord` — pair cleanup, deliberately OUTSIDE the guard. */
  pairCleanup: boolean
  /** The spy pre-hook registered on `first_name` ran. */
  preHooks: boolean
  /** `updateEntityInstance` row write — the archive-path `updatedAt` stamp site
   *  (D-7: `updateEntityInstance` stamps `updatedAt` explicitly). */
  rowWrite: boolean
}

type ScenarioObservations = Record<Op, OpObservation>

async function observeOp(run: () => Promise<unknown>): Promise<OpObservation> {
  h.publishLater.mockClear()
  h.publish.mockClear()
  h.enqueueDuplicateScan.mockClear()
  h.deleteOpenPairsForRecord.mockClear()
  h.preHook.mockClear()
  h.updateEntityInstance.mockClear()
  await run()
  return {
    busEvent: h.publishLater.mock.calls.length > 0,
    recordFrame: h.publish.mock.calls.some((c) => String(c[1]).startsWith('record:')),
    dedupEnqueue: h.enqueueDuplicateScan.mock.calls.length > 0,
    pairCleanup: h.deleteOpenPairsForRecord.mock.calls.length > 0,
    preHooks: h.preHook.mock.calls.length > 0,
    rowWrite: h.updateEntityInstance.mock.calls.length > 0,
  }
}

/** Drive one real handler through create → update → archive, recording doors. */
async function runScenario(
  makeHandler: () => UnifiedCrudHandler,
  options: CrudOptions = {}
): Promise<ScenarioObservations> {
  const handler = makeHandler()
  // The field-value write itself is not under test (its own doors — per-field
  // timeline, searchText, D-7 content stamp — are the field-value layer's).
  vi.spyOn(handler.fieldValueService, 'setValuesForEntity').mockResolvedValue(undefined as never)
  const recordId = 'def_1:inst_1' as RecordId
  const create = await observeOp(() => handler.create('contact', { first_name: 'Ada' }, options))
  const update = await observeOp(() =>
    handler.update(recordId, { first_name: 'Bo' }, undefined, options)
  )
  const archive = await observeOp(() => handler.archive(recordId, options))
  return { create, update, archive }
}

// ═══════════════════════════════════════════════════════════════════════════
// SCENARIOS — one real handler per write-origin kind (plus the alias lanes)
// ═══════════════════════════════════════════════════════════════════════════

// A REAL collector: the tier-1 lifecycle seams (plan 07 §4) call
// `recordCreated`/`recordArchived` on it during the sync scenario, so an
// empty `{} as ManifestCollector` stub would crash the handler under test.
const syncCollector = createManifestCollector({})
const syncSession = (): WriteSession => ({
  origin: { kind: 'sync', source: 'import', ref: 'run_conformance', collector: syncCollector },
  depth: 0,
})
const automationSession = (): WriteSession => ({
  origin: { kind: 'automation', actor: 'system_user', cause: { type: 'workflow', id: 'wf_1' } },
  depth: 0,
})

type ScenarioId = WriteOriginKind | 'api' | 'interactive-skip-events' | 'ambient-seed'

const observations = {} as Record<ScenarioId, ScenarioObservations>

beforeAll(async () => {
  const build = (session?: WriteSession) =>
    new UnifiedCrudHandler('org_1', 'user_1', {} as never, 'sock_1', session ? { session } : {})

  observations.interactive = await runScenario(() => build(interactiveSession('user_1', 'sock_1')))
  observations.api = await runScenario(() =>
    build({ origin: { kind: 'api', userId: 'user_1' }, depth: 0 })
  )
  observations.automation = await runScenario(() => build(automationSession()))
  // D-12: sync-small vs sync-large is decided at FINALIZE from the observed
  // changed count — a writer only ever declares `kind: 'sync'`. At the handler
  // seam the two matrix columns are therefore indistinguishable by design;
  // both are driven by the same sync session.
  const sync = await runScenario(() => build(syncSession()))
  observations['sync-small'] = sync
  observations['sync-large'] = sync
  observations.seed = await runScenario(() => build(seedSession('door-conformance')))

  // Alias lanes (asserted equivalent to seed below):
  observations['interactive-skip-events'] = await runScenario(
    () => build(interactiveSession('user_1', 'sock_1')),
    { skipEvents: true }
  )
  observations['ambient-seed'] = await runScenario(() =>
    // NO session option and NO CrudOptions — the handler inherits the ambient
    // seed session at construction and must suppress identically.
    runWithWriteSession(seedSession('ambient'), () => build())
  )
})

// ═══════════════════════════════════════════════════════════════════════════
// DOOR → OBSERVATION MAPPING
// ═══════════════════════════════════════════════════════════════════════════

type DoorConformance =
  | {
      kind: 'observed'
      /** The observation channel standing in for this door at the handler seam. */
      via: string
      /** The operations this door is expected on (matrix cells are op-agnostic). */
      ops: Op[]
      fired: (o: OpObservation) => boolean
    }
  | {
      kind: 'deferred'
      /** 'verified-elsewhere' = a real suite/layer owns it; 'unverifiable' = the
       *  machinery does not exist yet (plan reference in `where`). */
      status: 'verified-elsewhere' | 'unverifiable'
      where: string
    }

const busEvent = (o: OpObservation) => o.busEvent

/**
 * Every DOOR_MATRIX row classified. `Record<DoorId, …>` couples this table to
 * the matrix at the type level; the runtime set-equality test below re-asserts
 * it, so adding a door without classifying it here fails loudly.
 */
const DOOR_CONFORMANCE: Record<DoorId, DoorConformance> = {
  timelineEntry: {
    kind: 'observed',
    via: 'publishEvent → publisher.publishLater (timeline entries are bus-event handlers)',
    ops: ['create', 'update', 'archive'],
    fired: busEvent,
  },
  perFieldTimeline: {
    kind: 'deferred',
    status: 'verified-elsewhere',
    where:
      'field-value service (fieldValues:updated / entity:field:updated ride setValuesForEntity, ' +
      'gated by the same publishEvents boolean) — field-values tests; the sync-small per-record ' +
      'cell is executed at the sync finalize seam (per-field entity:field:updated replay off the ' +
      'claimed manifest — events/handlers/sync-finalize.test.ts); sync-large stays folded into ' +
      'the collapsed entry per D-4',
  },
  realtimeTier1: {
    kind: 'observed',
    via: "getRealtimeService().publish('record:created|updated|archived')",
    ops: ['create', 'update', 'archive'],
    fired: (o) => o.recordFrame,
  },
  realtimeTier2: {
    kind: 'deferred',
    status: 'verified-elsewhere',
    where:
      'sync finalize pass (events/handlers/sync-finalize.test.ts) — records:changed frames, ' +
      'ids+fieldIds per D-18, emitted for BOTH sync lanes (on sync-small as the tier-1 ' +
      'substitute; see the realtimeTier1 deviation). Interactive bulk archives emit the same ' +
      'frame (bulk-archive-records-changed.test.ts, D-17); other bulk-shaped producers are ' +
      'still future (plan 03 §7b). This harness drives single-record ops, which correctly ' +
      'stay tier-1 — no observation point at this seam',
  },
  realtimeTier3: {
    kind: 'deferred',
    status: 'verified-elsewhere',
    where:
      'sync/import records:invalidated publishers (connector sink, importer) — not routed ' +
      'through UnifiedCrudHandler; run:completed frame is Phase 4 (plan 03 §7b)',
  },
  notifications: {
    kind: 'observed',
    via: 'publishEvent → publisher.publishLater (notification delivery hangs off bus-event handlers)',
    ops: ['create', 'update', 'archive'],
    fired: busEvent,
  },
  recordRules: {
    kind: 'observed',
    via:
      'publishEvent → publisher.publishLater (inline rules route; the sync route is the B2 ' +
      'manifest collector, fed at the field-value seam)',
    ops: ['create', 'update', 'archive'],
    fired: busEvent,
  },
  workflowDispatch: {
    kind: 'observed',
    via: 'publishEvent → publisher.publishLater (dispatch triggers are bus-event handlers)',
    ops: ['create', 'update', 'archive'],
    fired: busEvent,
  },
  dedupScan: {
    kind: 'observed',
    via: 'enqueueDuplicateScan (create/update only — archive is never a reason to re-scan)',
    ops: ['create', 'update'],
    fired: (o) => o.dedupEnqueue,
  },
  enrichmentHooks: {
    kind: 'deferred',
    status: 'verified-elsewhere',
    where:
      'company-enrichment field hook (field-hooks layer); the sync-large guard is unimplemented ' +
      '(B-13, Phase 6/7 — needs a lane check in the native-action executor too)',
  },
  connectorMirrorHooks: {
    kind: 'deferred',
    status: 'verified-elsewhere',
    where:
      'app field-hook mirror layer (QuickBooks connector in auxxai-apps); echo suppression via session.cause',
  },
  inverseRelationshipVisibility: {
    kind: 'deferred',
    status: 'verified-elsewhere',
    where:
      'field-values/relationship-sync.ts `announceInverseChanges` — D-11 REALTIME arm landed: ' +
      'the diff is published on the inverse record (inline, or buffered via ' +
      'getAmbientTxWriteScope and replayed after COMMIT) and covered by ' +
      'field-values/__tests__/inverse-announcement.test.ts. ⚠️ The timeline and record-rule arms ' +
      'of this row are still unimplemented — the entry is no longer `unverifiable` because a ' +
      'seam now exists, not because the row is fully satisfied',
  },
  integrityHooks: {
    kind: 'deferred',
    status: 'verified-elsewhere',
    where:
      'field-hooks registry (totals / address / phone geo / inventory-BOM / pricing) — dead on ' +
      'sync writes today (B-1, Phase 5); seed batching per D-10 is unimplemented',
  },
  searchTextDisplayInverse: {
    kind: 'deferred',
    status: 'verified-elsewhere',
    where:
      'FieldValueService (maybeUpdateDisplayValue / searchText / inverse sync) — inline ' +
      'derived-state maintenance, part of the write itself; field-values tests',
  },
  lastActivityAt: {
    kind: 'deferred',
    status: 'verified-elsewhere',
    where:
      'entity-instances layer (create stamps it; updateEntityInstance bumps on archive/restore ' +
      'EXCEPT under a seed session — it reads the ambient write session and skips the bump, so ' +
      'the seed cell holds; entity-instances updated-at-stamp tests) plus the sync finalize pass ' +
      '(D-1 batched bump for both sync lanes — sync-finalize.test.ts). Sync content writes still ' +
      'skip the inline bump; finalize catches them up at run end',
  },
  updatedAtStamp: {
    kind: 'observed',
    via:
      'updateEntityInstance row write on the archive path (D-7 explicit stamp lives inside it); ' +
      'the create/update CONTENT stamp lives in setValuesForEntity — field-value layer',
    ops: ['archive'],
    fired: (o) => o.rowWrite,
  },
  cacheInvalidation: {
    kind: 'deferred',
    status: 'verified-elsewhere',
    where: 'org-cache invalidation graph (event → invalidation edges) — cache module tests',
  },
}

// ═══════════════════════════════════════════════════════════════════════════
// VERIFIED-ELSEWHERE CELLS — silent at this seam BY DESIGN, executed at finalize
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Individual (door, origin) cells of doors otherwise observed at this seam
 * whose truth-point is the sync finalize seam (PR #1806): the handler stays
 * silent by design, and `handle-sync-record-rules` → `runSyncFinalize`
 * executes the door off the claimed manifest at run end. Enforced BOTH ways
 * like the deviations: the conformance loop skips these cells, and a dedicated
 * test asserts the handler seam is STILL silent — inline firing would
 * double-execute the door against finalize, so a cell that starts firing here
 * fails its test and forces the entry's removal.
 */
const VERIFIED_ELSEWHERE_CELLS: Array<{
  door: DoorId
  origin: WriteOriginKind
  /** Defaults to every op the door observes. */
  ops?: Op[]
  expectedFromMatrix: string
  /** The suite where this cell's conformance actually lives. */
  where: string
}> = [
  {
    door: 'timelineEntry',
    origin: 'sync-small',
    expectedFromMatrix: 'per-record',
    where:
      'events/handlers/sync-finalize.test.ts — the D-12 finalize pass bulk-inserts per-field ' +
      'entity:field:updated rows for changed records plus collapsed created/archived entries ' +
      '(small-lane per-FIELD fidelity shipped; the large lane keeps the collapsed shape per D-4)',
  },
  {
    door: 'recordRules',
    origin: 'sync-small',
    expectedFromMatrix: 'per-record',
    where:
      'events/handlers/handle-sync-record-rules.test.ts — the B2 manifest route fires field + ' +
      'lifecycle rules per record off the claimed manifest (D-5); the inline bus route stays ' +
      'silent for sync so rules never run twice',
  },
  {
    door: 'workflowDispatch',
    origin: 'sync-small',
    expectedFromMatrix: 'per-record',
    where:
      'events/handlers/sync-finalize.test.ts — the finalize dispatch door fires ' +
      'triggerResourceDispatch per record on the small lane (D-2, fixes B-3); the large lane ' +
      'withholds pending the Phase 6 guard (D-3)',
  },
]

function findVerifiedElsewhere(door: DoorId, origin: WriteOriginKind, op: Op) {
  return VERIFIED_ELSEWHERE_CELLS.find(
    (c) => c.door === door && c.origin === origin && (c.ops === undefined || c.ops.includes(op))
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// KNOWN DEVIATIONS — the matrix (desired) vs the implementation (today)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Every place where DOOR_MATRIX and the current implementation — handler seam
 * AND finalize pass combined — still disagree. Each entry is enforced BOTH
 * ways: the conformance loop skips these cells, and a dedicated test asserts
 * the deviation is still real — so fixing the implementation (or editing the
 * cell) forces the entry's removal.
 */
const KNOWN_DEVIATIONS: Array<{
  door: DoorId
  origin: WriteOriginKind
  /** Defaults to every op the door observes. */
  ops?: Op[]
  expectedFromMatrix: string
  observed: 'silent' | 'fires-inline'
  ref: string
}> = [
  {
    door: 'notifications',
    origin: 'sync-small',
    expectedFromMatrix: 'per-record',
    observed: 'silent',
    ref:
      'plan 03 Phase 4 — the finalize pass (PR #1806) has NO notifications door: the matrix cell ' +
      'says per-record but nothing implements it at either seam, so sync writes still notify no one',
  },
  {
    door: 'realtimeTier1',
    origin: 'sync-small',
    expectedFromMatrix: 'per-record',
    observed: 'silent',
    ref:
      'plan 03 §7b — the finalize pass emits tier-2 records:changed frames (ids + fieldIds) for ' +
      'BOTH sync lanes as a substitute, but the cell asks for tier-1 per-record ' +
      'record:created|updated|archived frames and nothing emits those for sync; either finalize ' +
      'grows a small-lane tier-1 replay or the cell is argued down to tier-2',
  },
  {
    door: 'updatedAtStamp',
    origin: 'sync-large',
    ops: ['archive'],
    expectedFromMatrix: 'batched',
    observed: 'fires-inline',
    ref:
      'plan 03 §8 — the finalize pass deliberately has no updatedAt door (the D-7 write ' +
      'chokepoint stamps at write time), so the archive row write (updateEntityInstance) still ' +
      'runs inline for every origin, sync-large included',
  },
]

function findDeviation(door: DoorId, origin: WriteOriginKind, op: Op) {
  return KNOWN_DEVIATIONS.find(
    (d) => d.door === door && d.origin === origin && (d.ops === undefined || d.ops.includes(op))
  )
}

const fmtPolicy = (p: DoorPolicy) => (typeof p === 'object' ? `off (${p.off})` : p)

/** A matrix cell's handler-level expectation: only 'per-record' fires inline. */
const expectsInline = (p: DoorPolicy) => p === 'per-record'

// ═══════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe('door-matrix conformance at the handler seam', () => {
  it('classifies every matrix door exactly once (observed here vs deferred elsewhere)', () => {
    expect(Object.keys(DOOR_CONFORMANCE).sort()).toEqual(Object.keys(DOOR_MATRIX).sort())
  })

  it('sanity: the recorder discriminates — seed observations differ from interactive', () => {
    expect(observations.seed).not.toEqual(observations.interactive)
    // And the inline lane actually fired something.
    expect(observations.interactive.create.busEvent).toBe(true)
  })

  describe('observed doors match the matrix (minus KNOWN_DEVIATIONS)', () => {
    it('every observable (door, origin, op) cell agrees with DOOR_MATRIX', () => {
      const failures: string[] = []
      for (const [doorId, entry] of Object.entries(DOOR_MATRIX)) {
        const conf = DOOR_CONFORMANCE[doorId as DoorId]
        if (conf.kind !== 'observed') continue
        for (const origin of WRITE_ORIGIN_KINDS) {
          const policy = entry.policies[origin]
          for (const op of conf.ops) {
            if (findDeviation(doorId as DoorId, origin, op)) continue // enforced below
            if (findVerifiedElsewhere(doorId as DoorId, origin, op)) continue // enforced below
            const fired = conf.fired(observations[origin][op])
            if (fired !== expectsInline(policy)) {
              failures.push(
                `${doorId} / ${origin} / ${op}: matrix says '${fmtPolicy(policy)}' ` +
                  `(inline=${expectsInline(policy)}) but the handler observably ` +
                  `${fired ? 'FIRED' : 'stayed SILENT'} — via ${conf.via}`
              )
            }
          }
        }
      }
      expect(failures).toEqual([])
    })

    it('api behaves exactly like interactive (the matrix folds them into one column)', () => {
      expect(observations.api).toEqual(observations.interactive)
    })
  })

  describe('VERIFIED-ELSEWHERE CELLS — silent at this seam, executed at finalize', () => {
    it('every verified-elsewhere cell points at an observed door, a real origin, and a suite', () => {
      for (const c of VERIFIED_ELSEWHERE_CELLS) {
        expect(DOOR_CONFORMANCE[c.door].kind).toBe('observed')
        expect(WRITE_ORIGIN_KINDS).toContain(c.origin)
        expect(c.where).toMatch(/\.test\.ts/)
      }
    })

    it('a cell is either a deviation or verified-elsewhere, never both', () => {
      for (const c of VERIFIED_ELSEWHERE_CELLS) {
        const conf = DOOR_CONFORMANCE[c.door]
        if (conf.kind !== 'observed') throw new Error('verified-elsewhere on a deferred door')
        for (const op of c.ops ?? conf.ops) {
          expect(findDeviation(c.door, c.origin, op), `${c.door}/${c.origin}/${op}`).toBeUndefined()
        }
      }
    })

    for (const c of VERIFIED_ELSEWHERE_CELLS) {
      it(`${c.door} / ${c.origin}: matrix '${c.expectedFromMatrix}', handler silent — lives in ${c.where.split(' ')[0]}`, () => {
        const conf = DOOR_CONFORMANCE[c.door]
        if (conf.kind !== 'observed') throw new Error('verified-elsewhere on a deferred door')
        const policy = DOOR_MATRIX[c.door].policies[c.origin]
        // The cell must still say what the entry claims it says…
        expect(fmtPolicy(policy).startsWith(c.expectedFromMatrix)).toBe(true)
        // …and the handler seam must STILL be silent: finalize owns this cell,
        // so an inline fire would double-execute the door. When this fails, the
        // handler grew an inline path — remove the entry (and the finalize door).
        for (const op of c.ops ?? conf.ops) {
          const fired = conf.fired(observations[c.origin][op])
          expect(
            fired,
            `${c.door}/${c.origin}/${op} fired inline — it would double-execute against finalize`
          ).toBe(false)
        }
      })
    }
  })

  describe('KNOWN DEVIATIONS — matrix (desired) vs implementation (today)', () => {
    it('every deviation entry points at an observed door and a real origin', () => {
      for (const d of KNOWN_DEVIATIONS) {
        expect(DOOR_CONFORMANCE[d.door].kind).toBe('observed')
        expect(WRITE_ORIGIN_KINDS).toContain(d.origin)
        expect(d.ref.length).toBeGreaterThan(0)
      }
    })

    for (const d of KNOWN_DEVIATIONS) {
      it(`DEVIATION ${d.door} / ${d.origin}: matrix '${d.expectedFromMatrix}', observed ${d.observed} (${d.ref})`, () => {
        const conf = DOOR_CONFORMANCE[d.door]
        if (conf.kind !== 'observed') throw new Error('deviation on a deferred door')
        const entry = DOOR_MATRIX[d.door]
        const policy = entry.policies[d.origin]
        // The cell must still say what the entry claims it says…
        expect(fmtPolicy(policy).startsWith(d.expectedFromMatrix)).toBe(true)
        // …and the implementation must still disagree with it. When this fails,
        // the deviation has been fixed (or the cell edited): delete the entry.
        for (const op of d.ops ?? conf.ops) {
          const fired = conf.fired(observations[d.origin][op])
          expect(fired, `${d.door}/${d.origin}/${op} no longer deviates — remove the entry`).toBe(
            d.observed === 'fires-inline'
          )
          expect(fired).not.toBe(expectsInline(policy))
        }
      })
    }
  })

  describe('doors NOT observable at this seam', () => {
    // The skipped tests make the verified-elsewhere / unverifiable split visible
    // in the run output; the live test below keeps the classification honest.
    for (const [doorId, conf] of Object.entries(DOOR_CONFORMANCE)) {
      if (conf.kind !== 'deferred') continue
      it.skip(`${doorId} [${conf.status}] — ${conf.where}`, () => {})
    }

    it('every deferred door names where its conformance lives (or the plan phase that lands it)', () => {
      for (const [doorId, conf] of Object.entries(DOOR_CONFORMANCE)) {
        if (conf.kind !== 'deferred') continue
        expect(conf.where.length, doorId).toBeGreaterThan(10)
        expect(['verified-elsewhere', 'unverifiable']).toContain(conf.status)
        // A deferred door still only carries legal cell shapes — a cell edit to
        // something outside the vocabulary fails here even without observation.
        for (const origin of WRITE_ORIGIN_KINDS) {
          const policy = DOOR_MATRIX[doorId as DoorId].policies[origin]
          expect(
            policy === 'per-record' ||
              policy === 'batched' ||
              policy === 'guarded' ||
              (typeof policy === 'object' && typeof policy.off === 'string'),
            `${doorId}/${origin}`
          ).toBe(true)
        }
      }
    })
  })

  describe('doors OUTSIDE the matrix guard — must fire for EVERY origin', () => {
    it('duplicate-pair cleanup runs on archive for interactive, automation, sync, and seed', () => {
      for (const origin of WRITE_ORIGIN_KINDS) {
        expect(observations[origin].archive.pairCleanup, origin).toBe(true)
      }
      // …and under both alias lanes too.
      expect(observations['interactive-skip-events'].archive.pairCleanup).toBe(true)
      expect(observations['ambient-seed'].archive.pairCleanup).toBe(true)
    })

    it('pre-hooks run on create and update for every origin — seed included', () => {
      for (const origin of WRITE_ORIGIN_KINDS) {
        expect(observations[origin].create.preHooks, `${origin} create`).toBe(true)
        expect(observations[origin].update.preHooks, `${origin} update`).toBe(true)
      }
      expect(observations['interactive-skip-events'].create.preHooks).toBe(true)
      expect(observations['ambient-seed'].create.preHooks).toBe(true)
    })

    it('required-field validation still rejects under a seed session', async () => {
      h.state.fields = [
        { ...h.FIELD },
        {
          id: 'field_primary_email',
          name: 'Primary Email',
          systemAttribute: 'primary_email',
          required: true,
          isCreatable: true,
          isUnique: false,
        },
      ]
      try {
        const handler = new UnifiedCrudHandler('org_1', 'user_1', {} as never, undefined, {
          session: seedSession('validation-check'),
        })
        await expect(handler.create('contact', { first_name: 'Ada' })).rejects.toThrow(
          /Missing required fields/
        )
      } finally {
        h.state.fields = [h.FIELD]
      }
    })

    it('archiving never enqueues a dedup scan, on any origin', () => {
      for (const origin of WRITE_ORIGIN_KINDS) {
        expect(observations[origin].archive.dedupEnqueue, origin).toBe(false)
      }
    })
  })

  describe('the silent-lane aliases', () => {
    it('skipEvents: true under an interactive session behaves exactly like the seed lane', () => {
      expect(observations['interactive-skip-events']).toEqual(observations.seed)
    })

    it('an ambient seed session with NO options suppresses identically', () => {
      expect(observations['ambient-seed']).toEqual(observations.seed)
    })
  })
})
