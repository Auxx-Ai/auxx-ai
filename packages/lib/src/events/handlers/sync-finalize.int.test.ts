// packages/lib/src/events/handlers/sync-finalize.int.test.ts
//
// DB-backed behaviour test (vitest.integration.config.ts → auxx_test) for the Phase 4/5/6
// sync finalize pass of plans/events/03-write-context-and-batch-lane-plan.md.
//
// WHY INTEGRATION, next to the existing `sync-finalize.test.ts`. That suite mocks the
// db itself (`insert: vi.fn(() => ({ values: h.insertValues }))`), so every door is
// asserted as "the spy was called with this shape". Nothing has ever verified that the
// rows LAND: that the TimelineEvent insert satisfies its NOT NULL columns, that the
// `lastActivityAt` UPDATE's monotonic `or(IS NULL, <)` predicate actually matches the
// rows it should (and misses the ones it shouldn't), that `heldDispatches` round-trips
// through the jsonb `$type` column, or that a `bulk-dispatch` ApprovalRequest survives
// its own FK constraints. Those are predicate and constraint claims — a fake db proves
// none of them. This file drives `runSyncFinalize` against real rows and asserts the
// database afterwards.
//
// MANIFEST SHAPE. These tests hand `runSyncFinalize` a manifest directly and exercise
// the consumer on its own terms; `sync-manifest-collector` keeps its own unit coverage
// for capture. Since plan 07 the collector is ALWAYS real: tier-1 membership
// (`touched` + lifecycle) is unconditional, tier-2 `deltas` stay rule-subscription-
// gated. The `fromDeltas` fixtures model a fully rule-subscribed run; the
// tier-1-only suite at the bottom models the zero-rules run this harness previously
// could not express (the H-1 regression), and the v1 suite drives a pre-deploy
// manifest through `upgradeManifestV1`.
//
// WHAT IS MOCKED, and why each one is a true external:
//   - `../../cache`      — Redis-backed org cache. Re-implemented here against the test
//                          DB so canonicalization is REAL (slug-keyed import RecordIds →
//                          the org's EntityDefinition CUID is the #1784 lesson this pass
//                          re-applies, and it must be exercised, not stubbed).
//   - `../../realtime`   — Redis pub/sub. Spied to capture tier-2 frames.
//   - `./trigger-resource-dispatch` / `./trigger-resource-workflows` /
//     `../../resources/resource-fetcher` — the workflow engine and BullMQ.
// Everything else runs for real: the timeline insert, `touchEntityActivity`,
// `runIntegrityPasses`, `createBulkDispatchRequest`, and `persistHeldDispatches`.

import { type Database, schema } from '@auxx/database'
import { createTestOrganization, createTestUser, getTestDb } from '@auxx/test-utils'
import { toRecordId } from '@auxx/types/resource'
import { and, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SyncChangeManifest } from '../../record-rules/sync-manifest-types'
import {
  SYNC_SMALL_RUN_THRESHOLD,
  WORKFLOW_AUTO_DISPATCH_THRESHOLD,
} from '../../resources/crud/door-matrix'

const db = () => getTestDb() as never as Database

// ── Mocks: the true externals only ─────────────────────────────────────────────

const h = vi.hoisted(() => ({
  publishRecordsChanged:
    vi.fn<
      (
        svc: unknown,
        org: string,
        args: { entityDefinitionId: string; entries: Array<Record<string, unknown>> }
      ) => Promise<void>
    >(),
  triggerResourceDispatch:
    vi.fn<(args: { data: { type: string; data: Record<string, unknown> } }) => Promise<void>>(),
  matchResourceWorkflowTargets: vi.fn(),
  enqueueWorkflowTriggerJobs: vi.fn(),
  fetchResourceById: vi.fn(),
  /** Set per test: userId → role, for the bulk-dispatch approval audience. */
  roleMap: {} as Record<string, { userType: string; role: string }>,
}))

// Org cache, re-implemented against the test DB. `canonicalizeEntityDefinitionId`
// resolves an EntityDefinition by id OR apiSlug — the real behaviour import manifests
// depend on, since `ImportMapping.entityDefinitionId` is slug-keyed.
vi.mock('../../cache', () => {
  const tdb = () => getTestDb() as never as Database
  const { eq: eqOp, and: andOp, or: orOp } = require('drizzle-orm')

  const findDef = async (orgId: string, idOrSlug: string) => {
    const [def] = await tdb()
      .select()
      .from(schema.EntityDefinition)
      .where(
        andOp(
          eqOp(schema.EntityDefinition.organizationId, orgId),
          orOp(
            eqOp(schema.EntityDefinition.id, idOrSlug),
            eqOp(schema.EntityDefinition.apiSlug, idOrSlug)
          )
        )
      )
    return def ?? null
  }

  return {
    canonicalizeEntityDefinitionId: async (orgId: string, idOrSlug: string) =>
      (await findDef(orgId, idOrSlug))?.id ?? idOrSlug,
    findCachedResource: async (orgId: string, idOrSlug: string) => {
      const def = await findDef(orgId, idOrSlug)
      if (!def) return null
      return {
        id: def.id,
        entityDefinitionId: def.id,
        entityType: def.entityType,
        apiSlug: def.apiSlug,
      }
    },
    getCachedCustomFields: async (orgId: string, defId: string) =>
      await tdb()
        .select()
        .from(schema.CustomField)
        .where(
          andOp(
            eqOp(schema.CustomField.organizationId, orgId),
            eqOp(schema.CustomField.entityDefinitionId, defId)
          )
        ),
    getOrgCache: () => ({
      get: async (_orgId: string, key: string) => (key === 'memberRoleMap' ? h.roleMap : {}),
    }),
  }
})

vi.mock('../../realtime', () => ({
  getRealtimeService: () => ({ publish: vi.fn() }),
  publishRecordsChanged: h.publishRecordsChanged,
}))
vi.mock('./trigger-resource-dispatch', () => ({
  triggerResourceDispatch: h.triggerResourceDispatch,
}))
vi.mock('./trigger-resource-workflows', () => ({
  matchResourceWorkflowTargets: h.matchResourceWorkflowTargets,
  enqueueWorkflowTriggerJobs: h.enqueueWorkflowTriggerJobs,
}))
vi.mock('../../resources/resource-fetcher', () => ({
  fetchResourceById: h.fetchResourceById,
}))

import { runSyncFinalize } from './sync-finalize'

// ── Fixture ────────────────────────────────────────────────────────────────────

interface Fixture {
  orgId: string
  userId: string
  defId: string
  defSlug: string
  importJobId: string
}

/** An org with a `contacts` def and an ImportJob run row to hang the manifest off. */
async function seed(): Promise<Fixture> {
  const user = await createTestUser({ name: 'Importer' })
  const org = await createTestOrganization({ createdById: user.id })

  const [def] = await db()
    .insert(schema.EntityDefinition)
    .values({
      organizationId: org.id,
      entityType: 'contact',
      apiSlug: 'contacts',
      singular: 'contact',
      plural: 'contacts',
      updatedAt: new Date(),
    })
    .returning()

  const [mapping] = await db()
    .insert(schema.ImportMapping)
    .values({
      organizationId: org.id,
      entityDefinitionId: def!.apiSlug,
      title: 'Contacts CSV',
      createdById: user.id,
      updatedAt: new Date(),
    })
    .returning()

  const [job] = await db()
    .insert(schema.ImportJob)
    .values({
      organizationId: org.id,
      importMappingId: mapping!.id,
      sourceFileName: 'contacts.csv',
      columnCount: 3,
      rowCount: 500,
      status: 'completed',
      createdById: user.id,
      updatedAt: new Date(),
    })
    .returning()

  h.roleMap = { [user.id]: { userType: 'USER', role: 'OWNER' } }

  return {
    orgId: org.id,
    userId: user.id,
    defId: def!.id,
    defSlug: def!.apiSlug,
    importJobId: job!.id,
  }
}

/** Insert `count` contact instances, returning their ids. */
async function instances(f: Fixture, count: number, lastActivityAt?: Date): Promise<string[]> {
  const rows = Array.from({ length: count }, (_, i) => ({
    organizationId: f.orgId,
    entityDefinitionId: f.defId,
    displayName: `Contact ${i}`,
    ...(lastActivityAt ? { lastActivityAt } : {}),
    updatedAt: new Date(),
  }))
  const inserted = await db().insert(schema.EntityInstance).values(rows).returning()
  return inserted.map((r) => r.id)
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

/**
 * Tier-2 deltas plus the tier-1 `touched` entries a real collector derives from them
 * (`recordChange` implies `recordTouched` with the same keys) — the "every touched
 * field also has a delta" fixture shape, i.e. a fully rule-subscribed run.
 */
function fromDeltas(
  deltas: Record<string, Record<string, { o?: unknown; n: unknown }>>
): Partial<SyncChangeManifest> {
  const touched: Record<string, string[]> = {}
  for (const [rid, bucket] of Object.entries(deltas)) touched[rid] = Object.keys(bucket)
  return { touched, deltas } as never
}

/** Import manifests key RecordIds by SLUG — the keyspace finalize must canonicalize. */
const slugRid = (f: Fixture, instanceId: string) => toRecordId(f.defSlug, instanceId)

function importInput(f: Fixture, m: SyncChangeManifest) {
  return { organizationId: f.orgId, source: 'import' as const, ref: f.importJobId, manifest: m }
}

const timelineFor = async (f: Fixture) =>
  await db()
    .select()
    .from(schema.TimelineEvent)
    .where(eq(schema.TimelineEvent.organizationId, f.orgId))

const instanceRow = async (f: Fixture, id: string) => {
  const [row] = await db()
    .select()
    .from(schema.EntityInstance)
    .where(and(eq(schema.EntityInstance.id, id), eq(schema.EntityInstance.organizationId, f.orgId)))
  return row!
}

beforeEach(() => {
  vi.clearAllMocks()
  h.publishRecordsChanged.mockResolvedValue(undefined)
  h.triggerResourceDispatch.mockResolvedValue(undefined)
  h.matchResourceWorkflowTargets.mockResolvedValue({ match: {}, targets: [] })
  h.enqueueWorkflowTriggerJobs.mockResolvedValue(undefined)
  h.fetchResourceById.mockResolvedValue({ id: 'r', fields: {} })
})

// ═══════════════════════════════════════════════════════════════════════════════
// D-4 / [R] — timeline rows actually land, in the right shape, on the right lane
// ═══════════════════════════════════════════════════════════════════════════════

describe('timeline door (D-4)', () => {
  it('small lane writes one entity:field:updated row per changed field, with real deltas', async () => {
    const f = await seed()
    const [a, b] = await instances(f, 2)

    await runSyncFinalize(
      db(),
      importInput(
        f,
        manifest(
          fromDeltas({
            [slugRid(f, a!)]: {
              first_name: { o: 'Bob', n: 'Robert' },
              email: { o: null, n: 'r@example.com' },
            },
            [slugRid(f, b!)]: { first_name: { n: 'Ada' } },
          })
        )
      )
    )

    const rows = await timelineFor(f)
    expect(rows).toHaveLength(3)
    expect(rows.every((r) => r.eventType === 'entity:field:updated')).toBe(true)

    // entityType is the CANONICAL def CUID, never the slug the manifest carried.
    expect(new Set(rows.map((r) => r.entityType))).toEqual(new Set([f.defId]))
    expect(rows.every((r) => r.relatedEntityType === 'custom_field')).toBe(true)

    const aRows = rows.filter((r) => r.entityId === a)
    expect(new Set(aRows.map((r) => r.relatedEntityId))).toEqual(new Set(['first_name', 'email']))

    const firstName = aRows.find((r) => r.relatedEntityId === 'first_name')!
    expect(firstName.changes).toEqual([
      { field: 'first_name', oldValue: 'Bob', newValue: 'Robert' },
    ])
    expect(firstName.eventData).toMatchObject({
      recordId: toRecordId(f.defId, a!),
      entityDefinitionId: f.defId,
      fieldId: 'first_name',
      origin: 'sync',
      syncSource: 'import',
      syncRef: f.importJobId,
    })

    // `oldValue` is omitted, not fabricated, when the manifest never captured it.
    const bRow = rows.find((r) => r.entityId === b)!
    expect(bRow.changes).toEqual([{ field: 'first_name', newValue: 'Ada' }])

    // Actor is the ImportJob's createdById, resolved from the real row.
    expect(rows.every((r) => r.actorType === 'user' && r.actorId === f.userId)).toBe(true)
  })

  it('large lane collapses to ONE entity:updated row per record (D-4, not an upgrade path)', async () => {
    const f = await seed()
    const ids = await instances(f, SYNC_SMALL_RUN_THRESHOLD + 1)

    const deltas: Record<string, Record<string, { n: unknown }>> = {}
    for (const id of ids) deltas[slugRid(f, id)] = { first_name: { n: 'x' }, email: { n: 'y' } }

    await runSyncFinalize(db(), importInput(f, manifest(fromDeltas(deltas as never))))

    const rows = await timelineFor(f)
    // 101 records × 2 changed fields — collapsed, so 101 rows and not 202.
    expect(rows).toHaveLength(SYNC_SMALL_RUN_THRESHOLD + 1)
    expect(rows.every((r) => r.eventType === 'entity:updated')).toBe(true)
    expect(rows[0]!.eventData).toMatchObject({
      changedFieldCount: 2,
      changedFieldIds: ['first_name', 'email'],
    })
  })

  it('created and archived records collapse on BOTH lanes', async () => {
    const f = await seed()
    const [created, archived] = await instances(f, 2)

    await runSyncFinalize(
      db(),
      importInput(
        f,
        manifest({
          createdRecordIds: [slugRid(f, created!)],
          archivedRecordIds: [slugRid(f, archived!)],
        })
      )
    )

    const rows = await timelineFor(f)
    expect(rows).toHaveLength(2)
    expect(rows.find((r) => r.entityId === created)!.eventType).toBe('entity:created')
    expect(rows.find((r) => r.entityId === archived)!.eventType).toBe('entity:archived')
  })

  it('a record created AND changed this run collapses to created only, never both', async () => {
    const f = await seed()
    const [id] = await instances(f, 1)

    await runSyncFinalize(
      db(),
      importInput(
        f,
        manifest({
          createdRecordIds: [slugRid(f, id!)],
          ...fromDeltas({ [slugRid(f, id!)]: { first_name: { n: 'Ada' } } }),
        })
      )
    )

    const rows = await timelineFor(f)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.eventType).toBe('entity:created')
  })

  it('falls back to the system actor when the run has no attributable user', async () => {
    const f = await seed()
    await db()
      .update(schema.ImportJob)
      .set({ createdById: null })
      .where(eq(schema.ImportJob.id, f.importJobId))
    const [id] = await instances(f, 1)

    await runSyncFinalize(db(), importInput(f, manifest({ createdRecordIds: [slugRid(f, id!)] })))

    const rows = await timelineFor(f)
    expect(rows[0]!.actorType).toBe('system')
    expect(rows[0]!.actorId).toBe('system')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// D-1 — the lastActivityAt bump, and its monotonic predicate
// ═══════════════════════════════════════════════════════════════════════════════

describe('lastActivityAt door (D-1)', () => {
  it('bumps changed and created records but NOT archived ones — archival is not activity', async () => {
    const f = await seed()
    const [changed, created, archived] = await instances(f, 3)

    await runSyncFinalize(
      db(),
      importInput(
        f,
        manifest({
          ...fromDeltas({ [slugRid(f, changed!)]: { first_name: { n: 'Ada' } } }),
          createdRecordIds: [slugRid(f, created!)],
          archivedRecordIds: [slugRid(f, archived!)],
        })
      )
    )

    expect((await instanceRow(f, changed!)).lastActivityAt).not.toBeNull()
    expect((await instanceRow(f, created!)).lastActivityAt).not.toBeNull()
    expect((await instanceRow(f, archived!)).lastActivityAt).toBeNull()
  })

  it('never rewinds a record whose lastActivityAt is already newer', async () => {
    const f = await seed()
    const future = new Date(Date.now() + 60 * 60 * 1000)
    const [id] = await instances(f, 1, future)

    await runSyncFinalize(
      db(),
      importInput(f, manifest(fromDeltas({ [slugRid(f, id!)]: { first_name: { n: 'Ada' } } })))
    )

    expect((await instanceRow(f, id!)).lastActivityAt?.getTime()).toBe(future.getTime())
  })

  it('does NOT stamp updatedAt — activity is bookkeeping, not record content (D-7)', async () => {
    const f = await seed()
    const [id] = await instances(f, 1)
    const before = (await instanceRow(f, id!)).updatedAt

    await runSyncFinalize(
      db(),
      importInput(f, manifest(fromDeltas({ [slugRid(f, id!)]: { first_name: { n: 'Ada' } } })))
    )

    expect((await instanceRow(f, id!)).updatedAt.getTime()).toBe(before.getTime())
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// D-12 — lane selection, decided at finalize from the OBSERVED count
// ═══════════════════════════════════════════════════════════════════════════════

describe('lane selection (D-12)', () => {
  it('takes the small lane at exactly the threshold and the large lane one over', async () => {
    const atThreshold = await seed()
    const ids = await instances(atThreshold, SYNC_SMALL_RUN_THRESHOLD)
    const deltas: Record<string, Record<string, { n: unknown }>> = {}
    for (const id of ids) deltas[slugRid(atThreshold, id)] = { first_name: { n: 'x' } }
    await runSyncFinalize(db(), importInput(atThreshold, manifest(fromDeltas(deltas as never))))

    const smallRows = await timelineFor(atThreshold)
    expect(smallRows.every((r) => r.eventType === 'entity:field:updated')).toBe(true)
    // Small lane fires per-record dispatch (D-2, fixes B-3).
    expect(h.triggerResourceDispatch).toHaveBeenCalledTimes(SYNC_SMALL_RUN_THRESHOLD)

    vi.clearAllMocks()

    const over = await seed()
    const overIds = await instances(over, SYNC_SMALL_RUN_THRESHOLD + 1)
    const overDeltas: Record<string, Record<string, { n: unknown }>> = {}
    for (const id of overIds) overDeltas[slugRid(over, id)] = { first_name: { n: 'x' } }
    await runSyncFinalize(db(), importInput(over, manifest(fromDeltas(overDeltas as never))))

    const largeRows = await timelineFor(over)
    expect(largeRows.every((r) => r.eventType === 'entity:updated')).toBe(true)
    // Large lane withholds per-record dispatch — it routes through the guard.
    expect(h.triggerResourceDispatch).not.toHaveBeenCalled()
  })

  it('a MEMBERSHIP-truncated manifest forces the large lane regardless of how few it captured', async () => {
    const f = await seed()
    const [id] = await instances(f, 1)

    await runSyncFinalize(
      db(),
      importInput(
        f,
        manifest({
          membershipTruncated: true,
          ...fromDeltas({ [slugRid(f, id!)]: { first_name: { n: 'Ada' } } }),
        })
      )
    )

    const rows = await timelineFor(f)
    expect(rows[0]!.eventType).toBe('entity:updated')
    expect(h.triggerResourceDispatch).not.toHaveBeenCalled()
  })

  it('detail truncation alone keeps the honest count-based lane (small at a small count)', async () => {
    const f = await seed()
    const [id] = await instances(f, 1)

    await runSyncFinalize(
      db(),
      importInput(
        f,
        manifest({
          detailTruncated: true,
          ...fromDeltas({ [slugRid(f, id!)]: { first_name: { n: 'Ada' } } }),
        })
      )
    )

    const rows = await timelineFor(f)
    expect(rows[0]!.eventType).toBe('entity:field:updated')
    expect(h.triggerResourceDispatch).toHaveBeenCalledTimes(1)
  })

  it('an empty manifest is a complete no-op — no rows, no frames, no dispatch', async () => {
    const f = await seed()

    await runSyncFinalize(db(), importInput(f, manifest()))

    expect(await timelineFor(f)).toHaveLength(0)
    expect(h.publishRecordsChanged).not.toHaveBeenCalled()
    expect(h.triggerResourceDispatch).not.toHaveBeenCalled()
    // The tally is NOT written for an empty run — finalize returns before the doors.
    const [job] = await db()
      .select()
      .from(schema.ImportJob)
      .where(eq(schema.ImportJob.id, f.importJobId))
    expect(job!.heldDispatches).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// D-3 / D-13 / D-19 — the guarded dispatcher's persisted tally and approvals
// ═══════════════════════════════════════════════════════════════════════════════

describe('guarded dispatch (D-3 / D-13 / D-19)', () => {
  /** Force the large lane with `count` changed records, all matching `targets`. */
  async function largeRun(f: Fixture, count: number, targets: unknown[]) {
    const ids = await instances(f, count)
    const deltas: Record<string, Record<string, { n: unknown }>> = {}
    for (const id of ids) deltas[slugRid(f, id)] = { first_name: { n: 'x' } }
    h.matchResourceWorkflowTargets.mockResolvedValue({ match: {}, targets })
    await runSyncFinalize(
      db(),
      importInput(f, manifest({ membershipTruncated: true, ...fromDeltas(deltas as never) }))
    )
    return ids
  }

  const target = (over: Record<string, unknown> = {}) => ({
    workflowAppId: 'app_1',
    workflowId: 'wf_1',
    workflowName: 'Tag new contacts',
    triggerType: 'updated',
    jobEntityDefinitionId: 'contacts',
    ...over,
  })

  it('holds a workflow at the threshold: no enqueue, a real approval row, tally on the run', async () => {
    const f = await seed()
    await largeRun(f, WORKFLOW_AUTO_DISPATCH_THRESHOLD, [target()])

    expect(h.enqueueWorkflowTriggerJobs).not.toHaveBeenCalled()

    const [job] = await db()
      .select()
      .from(schema.ImportJob)
      .where(eq(schema.ImportJob.id, f.importJobId))
    const entries = job!.heldDispatches!
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      workflowId: 'wf_1',
      status: 'held',
      count: WORKFLOW_AUTO_DISPATCH_THRESHOLD,
      triggerType: 'updated',
    })
    // Held entries carry their record ids so an approval can enqueue them later.
    expect(entries[0]!.recordIds).toHaveLength(WORKFLOW_AUTO_DISPATCH_THRESHOLD)

    const approvals = await db()
      .select()
      .from(schema.ApprovalRequest)
      .where(eq(schema.ApprovalRequest.organizationId, f.orgId))
    expect(approvals).toHaveLength(1)
    expect(approvals[0]).toMatchObject({ kind: 'bulk-dispatch', status: 'pending' })
    expect(approvals[0]!.metadata).toMatchObject({
      source: 'import',
      ref: f.importJobId,
      workflowId: 'wf_1',
    })
    expect(approvals[0]!.assigneeUsers).toEqual([f.userId])
    // The entry points back at the request it filed.
    expect(entries[0]!.approvalRequestId).toBe(approvals[0]!.id)
  })

  it('auto-dispatches below the threshold, and records the auto entry without record ids', async () => {
    const f = await seed()
    await largeRun(f, WORKFLOW_AUTO_DISPATCH_THRESHOLD - 1, [target()])

    expect(h.enqueueWorkflowTriggerJobs).toHaveBeenCalledTimes(WORKFLOW_AUTO_DISPATCH_THRESHOLD - 1)

    const [job] = await db()
      .select()
      .from(schema.ImportJob)
      .where(eq(schema.ImportJob.id, f.importJobId))
    expect(job!.heldDispatches![0]).toMatchObject({ status: 'auto' })
    expect(job!.heldDispatches![0]!.recordIds).toBeUndefined()

    const approvals = await db()
      .select()
      .from(schema.ApprovalRequest)
      .where(eq(schema.ApprovalRequest.organizationId, f.orgId))
    expect(approvals).toHaveLength(0)
  })

  it('decides per workflow, not per run (D-13) — one held, one auto, in the same run', async () => {
    const f = await seed()
    // The two sets must be DISJOINT: `collectChangedSets` subtracts created records out
    // of `updatedIds` (a record created this run collapses to created, never both), so
    // overlapping them would starve the updated arm. 24 created → below the threshold →
    // auto; 25 updated → at the threshold → held.
    const ids = await instances(f, WORKFLOW_AUTO_DISPATCH_THRESHOLD * 2 - 1)
    const createdIds = ids.slice(0, WORKFLOW_AUTO_DISPATCH_THRESHOLD - 1)
    const deltas: Record<string, Record<string, { n: unknown }>> = {}
    for (const id of ids.slice(WORKFLOW_AUTO_DISPATCH_THRESHOLD - 1)) {
      deltas[slugRid(f, id)] = { first_name: { n: 'x' } }
    }

    // `entity:created` matches wf_auto; `entity:updated` matches wf_held.
    h.matchResourceWorkflowTargets.mockImplementation(async (event: never) => {
      const type = (event as { type: string }).type
      return type === 'entity:created'
        ? { match: {}, targets: [target({ workflowId: 'wf_auto', triggerType: 'created' })] }
        : { match: {}, targets: [target({ workflowId: 'wf_held' })] }
    })

    await runSyncFinalize(
      db(),
      importInput(
        f,
        manifest({
          membershipTruncated: true,
          ...fromDeltas(deltas as never),
          createdRecordIds: createdIds.map((id) => slugRid(f, id)),
        } as never)
      )
    )

    const [job] = await db()
      .select()
      .from(schema.ImportJob)
      .where(eq(schema.ImportJob.id, f.importJobId))
    const byId = Object.fromEntries(job!.heldDispatches!.map((e) => [e.workflowId, e]))
    expect(byId.wf_auto).toMatchObject({
      status: 'auto',
      count: WORKFLOW_AUTO_DISPATCH_THRESHOLD - 1,
    })
    expect(byId.wf_held).toMatchObject({
      status: 'held',
      count: WORKFLOW_AUTO_DISPATCH_THRESHOLD,
    })
    // Exactly one approval — the held workflow's. The auto one files nothing.
    const approvals = await db()
      .select()
      .from(schema.ApprovalRequest)
      .where(eq(schema.ApprovalRequest.organizationId, f.orgId))
    expect(approvals).toHaveLength(1)
    expect(approvals[0]!.metadata).toMatchObject({ workflowId: 'wf_held' })
  })

  it('writes an EMPTY tally when nothing matched — the trace that the door ran (D-3)', async () => {
    const f = await seed()
    await largeRun(f, 3, [])

    const [job] = await db()
      .select()
      .from(schema.ImportJob)
      .where(eq(schema.ImportJob.id, f.importJobId))
    // Empty array, NOT null — null means "finalize predates Phase 6".
    expect(job!.heldDispatches).toEqual([])
  })

  it('still persists the tally when the org has nobody to ask for approval', async () => {
    const f = await seed()
    h.roleMap = {} // no admins, and the actor is not a member
    await db()
      .update(schema.ImportJob)
      .set({ createdById: null })
      .where(eq(schema.ImportJob.id, f.importJobId))

    await largeRun(f, WORKFLOW_AUTO_DISPATCH_THRESHOLD, [target()])

    const [job] = await db()
      .select()
      .from(schema.ImportJob)
      .where(eq(schema.ImportJob.id, f.importJobId))
    expect(job!.heldDispatches![0]).toMatchObject({ status: 'held' })
    expect(job!.heldDispatches![0]!.approvalRequestId).toBeUndefined()
    expect(h.enqueueWorkflowTriggerJobs).not.toHaveBeenCalled()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// §7b — tier-2 records:changed frames
// ═══════════════════════════════════════════════════════════════════════════════

describe('tier-2 frames (§7b)', () => {
  it('groups by canonical def, carries fieldIds for changed and omits them elsewhere', async () => {
    const f = await seed()
    const [changed, created, archived] = await instances(f, 3)

    await runSyncFinalize(
      db(),
      importInput(
        f,
        manifest({
          ...fromDeltas({
            [slugRid(f, changed!)]: { first_name: { n: 'Ada' }, email: { n: 'a@b.c' } },
          }),
          createdRecordIds: [slugRid(f, created!)],
          archivedRecordIds: [slugRid(f, archived!)],
        })
      )
    )

    expect(h.publishRecordsChanged).toHaveBeenCalledTimes(1)
    const [, org, args] = h.publishRecordsChanged.mock.calls[0]!
    expect(org).toBe(f.orgId)
    // The slug-keyed manifest resolved to the org's CUID before it reached the room key.
    expect(args.entityDefinitionId).toBe(f.defId)

    const byRecord = Object.fromEntries(args.entries.map((e) => [e.recordId as string, e.fieldIds]))
    expect(byRecord[changed!]).toEqual(['first_name', 'email'])
    expect(byRecord[created!]).toBeUndefined()
    expect(byRecord[archived!]).toBeUndefined()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// The never-throws contract, against real failures rather than rejected spies
// ═══════════════════════════════════════════════════════════════════════════════

describe('never throws (finalize door contract)', () => {
  it('survives a manifest naming records and defs that do not exist', async () => {
    const f = await seed()

    await expect(
      runSyncFinalize(
        db(),
        importInput(
          f,
          manifest(fromDeltas({ [toRecordId('ghost_def', 'ghost_instance')]: { x: { n: 1 } } }))
        )
      )
    ).resolves.toBeUndefined()

    // The row still lands — the timeline does not verify the record exists.
    const rows = await timelineFor(f)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.entityType).toBe('ghost_def')
  })

  it('completes the remaining doors when the realtime publish fails', async () => {
    const f = await seed()
    const [id] = await instances(f, 1)
    h.publishRecordsChanged.mockRejectedValue(new Error('redis down'))

    await expect(
      runSyncFinalize(
        db(),
        importInput(f, manifest(fromDeltas({ [slugRid(f, id!)]: { first_name: { n: 'Ada' } } })))
      )
    ).resolves.toBeUndefined()

    // Realtime is the LAST door — the timeline and activity doors already committed.
    expect(await timelineFor(f)).toHaveLength(1)
    expect((await instanceRow(f, id!)).lastActivityAt).not.toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Plan 07 — the H-1 zero-rules regression: tier-1 membership alone drives finalize
// ═══════════════════════════════════════════════════════════════════════════════

describe('tier-1-only manifest (zero rule subscriptions)', () => {
  it('drives every door with touched keys + lifecycle and EMPTY deltas', async () => {
    const f = await seed()
    const [changed, created] = await instances(f, 2)

    // Exactly what a real collector with zero subscriptions emits: touched keys
    // and lifecycle ids, no `{o, n}` values anywhere.
    await runSyncFinalize(
      db(),
      importInput(
        f,
        manifest({
          touched: {
            [slugRid(f, changed!)]: ['first_name', 'email'],
            [slugRid(f, created!)]: ['first_name'],
          } as never,
          createdRecordIds: [slugRid(f, created!)],
        })
      )
    )

    // Timeline: per-field rows for the changed record WITHOUT value pairs (the
    // field name is tier-1 truth; values are tier-2 and were never captured),
    // plus the collapsed created row.
    const rows = await timelineFor(f)
    const changedRows = rows.filter((r) => r.entityId === changed)
    expect(changedRows).toHaveLength(2)
    expect(new Set(changedRows.map((r) => r.relatedEntityId))).toEqual(
      new Set(['first_name', 'email'])
    )
    for (const row of changedRows) {
      expect(row.eventType).toBe('entity:field:updated')
      expect(row.changes).toHaveLength(1)
      expect(Object.keys((row.changes as Array<Record<string, unknown>>)[0]!)).toEqual(['field'])
    }
    expect(rows.find((r) => r.entityId === created)!.eventType).toBe('entity:created')

    // Activity bumped for both.
    expect((await instanceRow(f, changed!)).lastActivityAt).not.toBeNull()
    expect((await instanceRow(f, created!)).lastActivityAt).not.toBeNull()

    // Small-lane dispatch fired per record.
    expect(h.triggerResourceDispatch).toHaveBeenCalledTimes(2)
    const types = h.triggerResourceDispatch.mock.calls.map(([a]) => a.data.type).sort()
    expect(types).toEqual(['entity:created', 'entity:updated'])

    // Tier-2 frames carry the touched keys as fieldIds.
    expect(h.publishRecordsChanged).toHaveBeenCalledTimes(1)
    const [, , frameArgs] = h.publishRecordsChanged.mock.calls[0]!
    const byRecord = Object.fromEntries(
      frameArgs.entries.map((e) => [e.recordId as string, e.fieldIds])
    )
    expect(byRecord[changed!]).toEqual(['first_name', 'email'])
    expect(byRecord[created!]).toBeUndefined()
  })

  it('collapses an ids-only degraded record (`touched[rid] === 1`) honestly', async () => {
    const f = await seed()
    const [id] = await instances(f, 1)

    await runSyncFinalize(
      db(),
      importInput(f, manifest({ touched: { [slugRid(f, id!)]: 1 } as never }))
    )

    const rows = await timelineFor(f)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.eventType).toBe('entity:updated')
    expect(rows[0]!.eventData).not.toHaveProperty('changedFieldIds')

    const [, , frameArgs] = h.publishRecordsChanged.mock.calls[0]!
    expect(frameArgs.entries).toEqual([{ recordId: id }])
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// One-release v1 shim — a pre-deploy manifest still works end-to-end through
// `upgradeManifestV1` (the shape `resolveManifest` hands finalize for a v1 row)
// ═══════════════════════════════════════════════════════════════════════════════

describe('v1 manifest through the upgrade shim', () => {
  it('upgrades and drives the doors exactly like a natively-v2 manifest', async () => {
    const f = await seed()
    const [changed, created] = await instances(f, 2)

    const { upgradeManifestV1 } = await import('../../record-rules/sync-manifest-collector')
    const upgraded = upgradeManifestV1({
      version: 1,
      truncated: false,
      changes: {
        [slugRid(f, changed!)]: { first_name: { o: 'Bob', n: 'Robert' } },
      } as never,
      createdRecordIds: [slugRid(f, created!)] as never,
      archivedRecordIds: [],
    })

    await runSyncFinalize(db(), importInput(f, upgraded))

    const rows = await timelineFor(f)
    const changedRow = rows.find((r) => r.entityId === changed)!
    expect(changedRow.eventType).toBe('entity:field:updated')
    // The delta survived the upgrade — value detail intact.
    expect(changedRow.changes).toEqual([
      { field: 'first_name', oldValue: 'Bob', newValue: 'Robert' },
    ])
    expect(rows.find((r) => r.entityId === created)!.eventType).toBe('entity:created')
    expect((await instanceRow(f, changed!)).lastActivityAt).not.toBeNull()
    expect(h.triggerResourceDispatch).toHaveBeenCalledTimes(2)
  })
})
