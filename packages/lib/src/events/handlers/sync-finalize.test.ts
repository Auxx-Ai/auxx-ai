// packages/lib/src/events/handlers/sync-finalize.test.ts
// Phase 4 sync finalize (plan events/03 §8, D-12): count-based lane selection,
// activity touch, timeline bulk insert (small lane: per-field replay; large
// lane: collapsed per D-4), small-lane dispatch, tier-2 frames, and the
// never-throws contract. Boundaries (activity/cache/dispatch/realtime/drizzle)
// mocked; the pure lane + count helpers run for real.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SyncChangeManifest } from '../../record-rules/sync-manifest-types'
import { SYNC_SMALL_RUN_THRESHOLD } from '../../resources/crud/door-matrix'

const h = vi.hoisted(() => ({
  touchEntityActivity: vi.fn<
    (ids: string[], org: string, at?: Date, tx?: unknown) => Promise<void>
  >(async () => {}),
  canonicalizeEntityDefinitionId: vi.fn(async (_org: string, defId: string) =>
    defId === 'part' ? 'def_cuid_part' : defId
  ),
  triggerResourceDispatch: vi.fn<
    (args: { data: { type: string; data: Record<string, unknown> } }) => Promise<void>
  >(async () => {}),
  publishRecordsChanged: vi.fn<
    (
      svc: unknown,
      org: string,
      args: { entityDefinitionId: string; entries: Array<Record<string, unknown>> }
    ) => Promise<void>
  >(async () => {}),
  getRealtimeService: vi.fn(() => ({ publish: vi.fn() })),
  insertValues: vi.fn<(rows: Array<Record<string, unknown>>) => Promise<void>>(async () => {}),
  runGuardedWorkflowDispatch: vi.fn<(db: unknown, input: Record<string, unknown>) => Promise<void>>(
    async () => {}
  ),
  runIntegrityPasses: vi.fn<(db: unknown, input: Record<string, unknown>) => Promise<void>>(
    async () => {}
  ),
}))

vi.mock('../../entity-instances/activity', () => ({
  touchEntityActivity: h.touchEntityActivity,
}))
vi.mock('../../cache', () => ({
  canonicalizeEntityDefinitionId: h.canonicalizeEntityDefinitionId,
}))
vi.mock('./trigger-resource-dispatch', () => ({
  triggerResourceDispatch: h.triggerResourceDispatch,
}))
vi.mock('./sync-dispatch-guard', () => ({
  runGuardedWorkflowDispatch: h.runGuardedWorkflowDispatch,
}))
vi.mock('./finalize-integrity-passes', () => ({
  runIntegrityPasses: h.runIntegrityPasses,
}))
vi.mock('../../realtime', () => ({
  getRealtimeService: h.getRealtimeService,
  publishRecordsChanged: h.publishRecordsChanged,
}))
// The finalize only uses `eq` for the actor lookups, against the shared setup's
// column-less schema proxy — partial-mock it so undefined columns can't throw.
vi.mock('drizzle-orm', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  eq: vi.fn(() => ({})),
}))

import { manifestDefCounts, runSyncFinalize, selectSyncLane } from './sync-finalize'

const ORG = 'org_1'

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

/**
 * Tier-2 deltas plus the tier-1 `touched` entries a real collector derives from them
 * (`recordChange` implies `recordTouched` with the same keys) — the common "every
 * touched field also has a delta" fixture shape.
 */
function fromDeltas(
  deltas: Record<string, Record<string, { o?: unknown; n: unknown }>>
): Partial<SyncChangeManifest> {
  const touched: Record<string, string[]> = {}
  for (const [rid, bucket] of Object.entries(deltas)) touched[rid] = Object.keys(bucket)
  return { touched, deltas } as never
}

/** Fake Database with just the surfaces finalize touches. */
function fakeDb(
  over: { connectorCreatedById?: string | null; importCreatedById?: string | null } = {}
) {
  return {
    query: {
      DataConnectorRun: {
        findFirst: vi.fn(async () => ({ dataConnectorId: 'conn_1' })),
      },
      DataConnector: {
        findFirst: vi.fn(async () => ({ createdById: over.connectorCreatedById ?? 'user_1' })),
      },
      ImportJob: {
        findFirst: vi.fn(async () => ({ createdById: over.importCreatedById ?? null })),
      },
    },
    insert: vi.fn(() => ({ values: h.insertValues })),
  } as never
}

function connectorInput(m: SyncChangeManifest) {
  return {
    organizationId: ORG,
    source: 'connector' as const,
    ref: 'run_1',
    dataConnectorId: 'conn_1',
    manifest: m,
  }
}

/** All rows across every chunked insert call. */
function insertedRows(): Array<Record<string, unknown>> {
  return h.insertValues.mock.calls.flatMap(([rows]) => rows)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('selectSyncLane', () => {
  it('takes the small lane at or below the threshold', () => {
    expect(selectSyncLane(manifest(), SYNC_SMALL_RUN_THRESHOLD)).toBe('small')
    expect(selectSyncLane(manifest(), 1)).toBe('small')
  })

  it('takes the large lane above the threshold', () => {
    expect(selectSyncLane(manifest(), SYNC_SMALL_RUN_THRESHOLD + 1)).toBe('large')
  })

  it('MEMBERSHIP truncation is large unconditionally — the true count is unknown', () => {
    expect(selectSyncLane(manifest({ membershipTruncated: true }), 1)).toBe('large')
  })

  it('detail truncation alone keeps the count-based lane — membership is complete', () => {
    expect(selectSyncLane(manifest({ detailTruncated: true }), 1)).toBe('small')
    expect(selectSyncLane(manifest({ detailTruncated: true }), SYNC_SMALL_RUN_THRESHOLD + 1)).toBe(
      'large'
    )
  })
})

describe('manifestDefCounts', () => {
  it('counts distinct records per def across touched, created, and archived', () => {
    const counts = manifestDefCounts(
      manifest({
        touched: { 'def_1:i1': ['f'], 'def_1:i2': ['f'] } as never,
        // i2 also created — must not double count.
        createdRecordIds: ['def_1:i2', 'part:i3'] as never,
        archivedRecordIds: ['part:i4'] as never,
      })
    )
    expect(counts).toEqual({ def_1: 2, part: 2 })
  })
})

describe('runSyncFinalize — small lane', () => {
  const smallManifest = () =>
    manifest({
      ...fromDeltas({
        'def_1:i1': { fld_a: { o: 1, n: 2 }, fld_b: { n: 'x' } },
        'def_1:i2': { fld_a: { o: null, n: 3 } },
      }),
      createdRecordIds: ['def_1:i3', 'part:i4'] as never,
      archivedRecordIds: ['def_1:i5'] as never,
    })

  it('bumps lastActivityAt for changed + created records (not archived)', async () => {
    await runSyncFinalize(fakeDb(), connectorInput(smallManifest()))
    expect(h.touchEntityActivity).toHaveBeenCalledTimes(1)
    const [ids, org] = h.touchEntityActivity.mock.calls[0]!
    expect(org).toBe(ORG)
    expect([...ids].sort()).toEqual(['i1', 'i2', 'i3', 'i4'])
  })

  it('bulk-inserts per-field rows for changed records + collapsed created/archived, attributed to the run actor', async () => {
    await runSyncFinalize(
      fakeDb({ connectorCreatedById: 'user_1' }),
      connectorInput(smallManifest())
    )
    const rows = insertedRows()
    // 3 changed fields across i1 + i2, plus created i3/i4 and archived i5.
    expect(rows).toHaveLength(6)
    const byId = new Map(rows.map((r) => [r.entityId, r]))
    expect(byId.get('i3')).toMatchObject({ eventType: 'entity:created', entityType: 'def_1' })
    // Slug-keyed def canonicalized for the timeline keyspace.
    expect(byId.get('i4')).toMatchObject({
      eventType: 'entity:created',
      entityType: 'def_cuid_part',
    })
    expect(byId.get('i5')).toMatchObject({ eventType: 'entity:archived' })

    // Per-field replay for i1: one `entity:field:updated` row per changed
    // field, mirroring the inline mapFieldUpdated shape (related custom_field
    // pointer, fieldId in eventData, raw o/n pair in `changes`).
    const i1Rows = rows.filter((r) => r.entityId === 'i1')
    expect(i1Rows).toHaveLength(2)
    const byField = new Map(i1Rows.map((r) => [r.relatedEntityId, r]))
    expect(byField.get('fld_a')).toMatchObject({
      eventType: 'entity:field:updated',
      entityType: 'def_1',
      relatedEntityType: 'custom_field',
      relatedEntityId: 'fld_a',
      eventData: expect.objectContaining({
        recordId: 'def_1:i1',
        entityDefinitionId: 'def_1',
        fieldId: 'fld_a',
        syncSource: 'connector',
        syncRef: 'run_1',
      }),
      changes: [{ field: 'fld_a', oldValue: 1, newValue: 2 }],
    })
    // No captured old value → no oldValue key (absence, not null).
    expect(byField.get('fld_b')).toMatchObject({
      eventType: 'entity:field:updated',
      changes: [{ field: 'fld_b', newValue: 'x' }],
    })
    expect((byField.get('fld_b')!.changes as Array<Record<string, unknown>>)[0]).not.toHaveProperty(
      'oldValue'
    )
    // A captured null old value IS carried (o: null on i2's fld_a).
    expect(byId.get('i2')).toMatchObject({
      eventType: 'entity:field:updated',
      changes: [{ field: 'fld_a', oldValue: null, newValue: 3 }],
    })
    // No collapsed entity:updated rows remain on the small lane.
    expect(rows.some((r) => r.eventType === 'entity:updated')).toBe(false)
    for (const row of rows) {
      expect(row).toMatchObject({ actorType: 'user', actorId: 'user_1', organizationId: ORG })
    }
  })

  it('uses the system actor when the run has no attributable user (import)', async () => {
    await runSyncFinalize(fakeDb({ importCreatedById: null }), {
      organizationId: ORG,
      source: 'import',
      ref: 'job_1',
      manifest: manifest(fromDeltas({ 'def_1:i1': { f: { n: 1 } } })),
    })
    expect(insertedRows()[0]).toMatchObject({ actorType: 'system', actorId: 'system' })
  })

  it('dispatches workflows/agents per record: created as entity:created, changed as entity:updated', async () => {
    await runSyncFinalize(fakeDb(), connectorInput(smallManifest()))
    expect(h.triggerResourceDispatch).toHaveBeenCalledTimes(4)
    const events = h.triggerResourceDispatch.mock.calls.map(([args]) => args.data)
    const created = events.filter((e) => e.type === 'entity:created')
    const updated = events.filter((e) => e.type === 'entity:updated')
    expect(created.map((e) => e.data.recordId).sort()).toEqual(['def_1:i3', 'def_cuid_part:i4'])
    expect(updated.map((e) => e.data.recordId).sort()).toEqual(['def_1:i1', 'def_1:i2'])
    expect(created[0]!.data).toMatchObject({ organizationId: ORG, userId: 'user_1' })
    // Archived records are not dispatched in v1.
    expect(events.some((e) => (e.data.recordId as string).endsWith(':i5'))).toBe(false)
  })

  it('publishes tier-2 records:changed frames grouped per canonical def', async () => {
    await runSyncFinalize(fakeDb(), connectorInput(smallManifest()))
    expect(h.publishRecordsChanged).toHaveBeenCalledTimes(2)
    const byDef = new Map(
      h.publishRecordsChanged.mock.calls.map(([, , args]) => [
        args.entityDefinitionId,
        args.entries,
      ])
    )
    expect(byDef.get('def_1')).toEqual(
      expect.arrayContaining([
        { recordId: 'i1', fieldIds: ['fld_a', 'fld_b'] },
        { recordId: 'i2', fieldIds: ['fld_a'] },
        { recordId: 'i3' },
        { recordId: 'i5' },
      ])
    )
    expect(byDef.get('def_cuid_part')).toEqual([{ recordId: 'i4' }])
  })

  it('does nothing for an empty manifest', async () => {
    await runSyncFinalize(fakeDb(), connectorInput(manifest()))
    expect(h.touchEntityActivity).not.toHaveBeenCalled()
    expect(h.insertValues).not.toHaveBeenCalled()
    expect(h.triggerResourceDispatch).not.toHaveBeenCalled()
    expect(h.publishRecordsChanged).not.toHaveBeenCalled()
  })
})

// The H-1 regression (plan 07): a collector with ZERO rule subscriptions still
// produces tier-1 membership, and that alone must drive every finalize door.
describe('runSyncFinalize — tier-1-only manifest (zero rule subscriptions)', () => {
  const tier1Manifest = () =>
    manifest({
      // Touched keys but EMPTY deltas — nothing was rule-subscribed.
      touched: { 'def_1:i1': ['fld_a', 'fld_b'], 'def_1:i2': ['fld_a'] } as never,
      createdRecordIds: ['def_1:i3'] as never,
      archivedRecordIds: ['def_1:i5'] as never,
    })

  it('drives every door off membership alone', async () => {
    await runSyncFinalize(fakeDb(), connectorInput(tier1Manifest()))

    // Activity bumped for touched + created (not archived).
    const [ids] = h.touchEntityActivity.mock.calls[0]!
    expect([...ids].sort()).toEqual(['i1', 'i2', 'i3'])

    // Small-lane per-field rows land WITHOUT a value pair — the field name is
    // tier-1 truth, `{o, n}` is tier-2 and was never captured.
    const rows = insertedRows()
    const i1Rows = rows.filter((r) => r.entityId === 'i1')
    expect(i1Rows).toHaveLength(2)
    for (const row of i1Rows) {
      expect(row.eventType).toBe('entity:field:updated')
      const changes = row.changes as Array<Record<string, unknown>>
      expect(changes).toHaveLength(1)
      expect(Object.keys(changes[0]!)).toEqual(['field'])
    }
    expect(rows.find((r) => r.entityId === 'i3')!.eventType).toBe('entity:created')
    expect(rows.find((r) => r.entityId === 'i5')!.eventType).toBe('entity:archived')

    // Integrity passes get the manifest (they select off touched keys).
    expect(h.runIntegrityPasses).toHaveBeenCalledTimes(1)

    // Dispatch: created + both updated records.
    expect(h.triggerResourceDispatch).toHaveBeenCalledTimes(3)

    // Tier-2 frames carry the touched keys as fieldIds.
    const [, , frameArgs] = h.publishRecordsChanged.mock.calls[0]!
    const byRecord = Object.fromEntries(
      frameArgs.entries.map((e) => [e.recordId as string, e.fieldIds])
    )
    expect(byRecord.i1).toEqual(['fld_a', 'fld_b'])
    expect(byRecord.i2).toEqual(['fld_a'])
    expect(byRecord.i3).toBeUndefined()
  })

  it('an ids-only touched record (`1`) collapses instead of writing per-field rows', async () => {
    await runSyncFinalize(
      fakeDb(),
      connectorInput(
        manifest({
          touched: { 'def_1:i1': 1, 'def_1:i2': ['fld_a'] } as never,
        })
      )
    )
    const rows = insertedRows()
    const i1Row = rows.find((r) => r.entityId === 'i1')!
    expect(i1Row.eventType).toBe('entity:updated')
    // Honest collapse: no fabricated changedFieldIds for a record whose keys were shed.
    expect(i1Row.eventData).not.toHaveProperty('changedFieldIds')
    expect(rows.find((r) => r.entityId === 'i2')!.eventType).toBe('entity:field:updated')

    // The frame for the ids-only record ships without fieldIds ("any field").
    const [, , frameArgs] = h.publishRecordsChanged.mock.calls[0]!
    const byRecord = Object.fromEntries(frameArgs.entries.map((e) => [e.recordId as string, e]))
    expect(byRecord.i1).toEqual({ recordId: 'i1' })
    expect(byRecord.i2).toEqual({ recordId: 'i2', fieldIds: ['fld_a'] })
  })
})

describe('runSyncFinalize — large lane', () => {
  const largeManifest = () => {
    const deltas: Record<string, Record<string, { n: unknown }>> = {}
    for (let i = 0; i < SYNC_SMALL_RUN_THRESHOLD + 1; i++) {
      deltas[`def_1:r${i}`] = { fld_a: { n: i } }
    }
    return manifest(fromDeltas(deltas))
  }

  it('routes dispatch through the Phase 6 guard (D-3) but still touches activity, timeline, and frames', async () => {
    await runSyncFinalize(fakeDb(), connectorInput(largeManifest()))
    expect(h.triggerResourceDispatch).not.toHaveBeenCalled()
    expect(h.runGuardedWorkflowDispatch).toHaveBeenCalledTimes(1)
    const [, guardInput] = h.runGuardedWorkflowDispatch.mock.calls[0]!
    expect(guardInput).toMatchObject({
      organizationId: ORG,
      source: 'connector',
      ref: 'run_1',
      actorUserId: 'user_1',
    })
    expect((guardInput.updatedIds as string[]).length).toBe(SYNC_SMALL_RUN_THRESHOLD + 1)
    expect(h.touchEntityActivity).toHaveBeenCalled()
    // The large lane keeps EXACTLY one collapsed entity:updated row per record
    // (D-4) — the per-field replay is a small-lane upgrade only.
    const rows = insertedRows()
    expect(rows).toHaveLength(SYNC_SMALL_RUN_THRESHOLD + 1)
    for (const row of rows) {
      expect(row).toMatchObject({
        eventType: 'entity:updated',
        eventData: expect.objectContaining({ changedFieldIds: ['fld_a'], changedFieldCount: 1 }),
      })
    }
    expect(h.publishRecordsChanged).toHaveBeenCalledTimes(1)
  })

  it('a MEMBERSHIP-truncated manifest takes the large lane even at a tiny observed count', async () => {
    await runSyncFinalize(
      fakeDb(),
      connectorInput(
        manifest({
          membershipTruncated: true,
          ...fromDeltas({ 'def_1:i1': { f: { n: 1 } } }),
        })
      )
    )
    expect(h.triggerResourceDispatch).not.toHaveBeenCalled()
    expect(h.runGuardedWorkflowDispatch).toHaveBeenCalledTimes(1)
    expect(h.publishRecordsChanged).toHaveBeenCalledTimes(1)
  })

  it('a detail-truncated manifest stays on the small lane at a small observed count', async () => {
    await runSyncFinalize(
      fakeDb(),
      connectorInput(
        manifest({
          detailTruncated: true,
          ...fromDeltas({ 'def_1:i1': { f: { n: 1 } } }),
        })
      )
    )
    expect(h.runGuardedWorkflowDispatch).not.toHaveBeenCalled()
    expect(h.triggerResourceDispatch).toHaveBeenCalledTimes(1)
  })

  it('the small lane never touches the guard', async () => {
    await runSyncFinalize(
      fakeDb(),
      connectorInput(manifest(fromDeltas({ 'def_1:i1': { f: { n: 1 } } })))
    )
    expect(h.runGuardedWorkflowDispatch).not.toHaveBeenCalled()
    expect(h.triggerResourceDispatch).toHaveBeenCalledTimes(1)
  })
})

describe('runSyncFinalize — integrity passes door (B-1)', () => {
  it('runs the integrity passes on the small lane, before dispatch', async () => {
    await runSyncFinalize(
      fakeDb(),
      connectorInput(manifest(fromDeltas({ 'def_1:i1': { f: { n: 1 } } })))
    )
    expect(h.runIntegrityPasses).toHaveBeenCalledTimes(1)
    const [, input] = h.runIntegrityPasses.mock.calls[0]!
    expect(input).toMatchObject({ organizationId: ORG })
    expect(h.runIntegrityPasses.mock.invocationCallOrder[0]!).toBeLessThan(
      h.triggerResourceDispatch.mock.invocationCallOrder[0]!
    )
  })

  it('runs the integrity passes on the large lane too', async () => {
    const deltas: Record<string, Record<string, { n: unknown }>> = {}
    for (let i = 0; i < SYNC_SMALL_RUN_THRESHOLD + 1; i++) {
      deltas[`def_1:r${i}`] = { fld_a: { n: i } }
    }
    await runSyncFinalize(fakeDb(), connectorInput(manifest(fromDeltas(deltas))))
    expect(h.runIntegrityPasses).toHaveBeenCalledTimes(1)
  })

  it('a rejecting integrity door does not break the remaining doors', async () => {
    h.runIntegrityPasses.mockRejectedValueOnce(new Error('boom'))
    await runSyncFinalize(
      fakeDb(),
      connectorInput(manifest(fromDeltas({ 'def_1:i1': { f: { n: 1 } } })))
    )
    expect(h.triggerResourceDispatch).toHaveBeenCalledTimes(1)
    expect(h.publishRecordsChanged).toHaveBeenCalledTimes(1)
  })
})

describe('runSyncFinalize — failure isolation', () => {
  it('a failing door never rejects, and later doors still run', async () => {
    h.insertValues.mockRejectedValueOnce(new Error('insert boom'))
    await expect(
      runSyncFinalize(
        fakeDb(),
        connectorInput(manifest(fromDeltas({ 'def_1:i1': { f: { n: 1 } } })))
      )
    ).resolves.toBeUndefined()
    // Timeline failed, but dispatch and realtime still happened.
    expect(h.triggerResourceDispatch).toHaveBeenCalledTimes(1)
    expect(h.publishRecordsChanged).toHaveBeenCalledTimes(1)
  })

  it('an activity failure never rejects', async () => {
    h.touchEntityActivity.mockRejectedValueOnce(new Error('touch boom'))
    await expect(
      runSyncFinalize(
        fakeDb(),
        connectorInput(manifest(fromDeltas({ 'def_1:i1': { f: { n: 1 } } })))
      )
    ).resolves.toBeUndefined()
    expect(h.publishRecordsChanged).toHaveBeenCalledTimes(1)
  })
})
