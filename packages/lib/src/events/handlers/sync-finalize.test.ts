// packages/lib/src/events/handlers/sync-finalize.test.ts
// Phase 4 sync finalize (plan events/03 §8, D-12): count-based lane selection,
// activity touch, collapsed timeline bulk insert, small-lane dispatch, tier-2
// frames, and the never-throws contract. Boundaries (activity/cache/dispatch/
// realtime/drizzle) mocked; the pure lane + count helpers run for real.

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
    version: 1,
    truncated: false,
    changes: {},
    createdRecordIds: [],
    archivedRecordIds: [],
    ...over,
  } as SyncChangeManifest
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

  it('a truncated manifest is large unconditionally — the true count is unknown', () => {
    expect(selectSyncLane(manifest({ truncated: true }), 1)).toBe('large')
  })
})

describe('manifestDefCounts', () => {
  it('counts distinct records per def across changes, created, and archived', () => {
    const counts = manifestDefCounts(
      manifest({
        changes: { 'def_1:i1': { f: { n: 1 } }, 'def_1:i2': { f: { n: 1 } } } as never,
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
      changes: {
        'def_1:i1': { fld_a: { o: 1, n: 2 }, fld_b: { n: 'x' } },
        'def_1:i2': { fld_a: { o: null, n: 3 } },
      } as never,
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

  it('bulk-inserts one collapsed timeline entry per record, attributed to the run actor', async () => {
    await runSyncFinalize(
      fakeDb({ connectorCreatedById: 'user_1' }),
      connectorInput(smallManifest())
    )
    const rows = insertedRows()
    expect(rows).toHaveLength(5)
    const byId = new Map(rows.map((r) => [r.entityId, r]))
    expect(byId.get('i3')).toMatchObject({ eventType: 'entity:created', entityType: 'def_1' })
    // Slug-keyed def canonicalized for the timeline keyspace.
    expect(byId.get('i4')).toMatchObject({
      eventType: 'entity:created',
      entityType: 'def_cuid_part',
    })
    expect(byId.get('i1')).toMatchObject({
      eventType: 'entity:updated',
      eventData: expect.objectContaining({
        changedFieldIds: ['fld_a', 'fld_b'],
        changedFieldCount: 2,
        syncSource: 'connector',
        syncRef: 'run_1',
      }),
    })
    expect(byId.get('i5')).toMatchObject({ eventType: 'entity:archived' })
    for (const row of rows) {
      expect(row).toMatchObject({ actorType: 'user', actorId: 'user_1', organizationId: ORG })
    }
  })

  it('uses the system actor when the run has no attributable user (import)', async () => {
    await runSyncFinalize(fakeDb({ importCreatedById: null }), {
      organizationId: ORG,
      source: 'import',
      ref: 'job_1',
      manifest: manifest({ changes: { 'def_1:i1': { f: { n: 1 } } } as never }),
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

describe('runSyncFinalize — large lane', () => {
  const largeManifest = () => {
    const changes: Record<string, Record<string, { n: unknown }>> = {}
    for (let i = 0; i < SYNC_SMALL_RUN_THRESHOLD + 1; i++) {
      changes[`def_1:r${i}`] = { fld_a: { n: i } }
    }
    return manifest({ changes: changes as never })
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
    expect(insertedRows()).toHaveLength(SYNC_SMALL_RUN_THRESHOLD + 1)
    expect(h.publishRecordsChanged).toHaveBeenCalledTimes(1)
  })

  it('a truncated manifest takes the large lane even at a tiny observed count', async () => {
    await runSyncFinalize(
      fakeDb(),
      connectorInput(
        manifest({ truncated: true, changes: { 'def_1:i1': { f: { n: 1 } } } as never })
      )
    )
    expect(h.triggerResourceDispatch).not.toHaveBeenCalled()
    expect(h.runGuardedWorkflowDispatch).toHaveBeenCalledTimes(1)
    expect(h.publishRecordsChanged).toHaveBeenCalledTimes(1)
  })

  it('the small lane never touches the guard', async () => {
    await runSyncFinalize(
      fakeDb(),
      connectorInput(manifest({ changes: { 'def_1:i1': { f: { n: 1 } } } as never }))
    )
    expect(h.runGuardedWorkflowDispatch).not.toHaveBeenCalled()
    expect(h.triggerResourceDispatch).toHaveBeenCalledTimes(1)
  })
})

describe('runSyncFinalize — integrity passes door (B-1)', () => {
  it('runs the integrity passes on the small lane, before dispatch', async () => {
    await runSyncFinalize(
      fakeDb(),
      connectorInput(manifest({ changes: { 'def_1:i1': { f: { n: 1 } } } as never }))
    )
    expect(h.runIntegrityPasses).toHaveBeenCalledTimes(1)
    const [, input] = h.runIntegrityPasses.mock.calls[0]!
    expect(input).toMatchObject({ organizationId: ORG })
    expect(h.runIntegrityPasses.mock.invocationCallOrder[0]!).toBeLessThan(
      h.triggerResourceDispatch.mock.invocationCallOrder[0]!
    )
  })

  it('runs the integrity passes on the large lane too', async () => {
    const changes: Record<string, Record<string, { n: unknown }>> = {}
    for (let i = 0; i < SYNC_SMALL_RUN_THRESHOLD + 1; i++) {
      changes[`def_1:r${i}`] = { fld_a: { n: i } }
    }
    await runSyncFinalize(fakeDb(), connectorInput(manifest({ changes: changes as never })))
    expect(h.runIntegrityPasses).toHaveBeenCalledTimes(1)
  })

  it('a rejecting integrity door does not break the remaining doors', async () => {
    h.runIntegrityPasses.mockRejectedValueOnce(new Error('boom'))
    await runSyncFinalize(
      fakeDb(),
      connectorInput(manifest({ changes: { 'def_1:i1': { f: { n: 1 } } } as never }))
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
        connectorInput(manifest({ changes: { 'def_1:i1': { f: { n: 1 } } } as never }))
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
        connectorInput(manifest({ changes: { 'def_1:i1': { f: { n: 1 } } } as never }))
      )
    ).resolves.toBeUndefined()
    expect(h.publishRecordsChanged).toHaveBeenCalledTimes(1)
  })
})
