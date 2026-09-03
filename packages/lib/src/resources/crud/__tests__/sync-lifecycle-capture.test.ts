// packages/lib/src/resources/crud/__tests__/sync-lifecycle-capture.test.ts
//
// Tier-1 lifecycle capture at the unified-handler mutation seams (plan 07 §4,
// PR 1): createEntity / archiveEntity / deleteEntity under a sync-session
// origin record unconditional membership on the session's collector
// (recordCreated / recordArchived). PR 2: `createdValues` moved to the engine —
// createEntity captures the raw systemAttribute-keyed written values
// (extractEventData shape) and passes them to recordCreated, gated on a
// lifecycle `created` subscription exactly as the producer capture was.
// Interactive and seed sessions record nothing, and the inline lane's own
// doors are untouched.
//
// @auxx/database is globally mocked in src/test/setup.ts; the mutation-seam
// mocks mirror write-session.test.ts (spread-preserving where the module has
// more exports).

import { ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  deleteOpenPairsForRecord: vi.fn(async () => ok(0)),
  enqueueDuplicateScan: vi.fn(async () => 'job_1'),
  publish: vi.fn(async () => {}),
  publishLater: vi.fn(() => {}),
  deleteCommentsByRecordId: vi.fn(async () => {}),
}))

vi.mock('../../../dedup/pairs', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  deleteOpenPairsForRecord: h.deleteOpenPairsForRecord,
  deleteOpenPairsForRecords: vi.fn(async () => ok(0)),
}))
vi.mock('../../../dedup/enqueue-scan', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  enqueueDuplicateScan: h.enqueueDuplicateScan,
}))
vi.mock('../../../entity-instances', () => ({
  getEntityInstance: vi.fn(async () => ok({ id: 'inst_1', archivedAt: null })),
  getEntityInstanceRow: vi.fn(async () => ({ id: 'inst_1', archivedAt: null })),
  updateEntityInstance: vi.fn(async () => ok({ id: 'inst_1' })),
  createEntityInstance: vi.fn(async () => ok({ id: 'inst_1' })),
  deleteEntityInstance: vi.fn(async () => ok({ id: 'inst_1' })),
  archiveEntityInstances: vi.fn(async (p: { ids: readonly string[] }) => ok([...new Set(p.ids)])),
}))
vi.mock('../../../realtime', () => ({
  getRealtimeService: () => ({ publish: h.publish }),
  publishRecordsChanged: vi.fn(async () => {}),
  rooms: { orgRecords: () => 'room' },
}))
vi.mock('../../../events/publisher', () => ({
  publisher: { publishLater: h.publishLater, publish: h.publishLater },
}))
vi.mock('../../../cache', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  findCachedResource: vi.fn(async () => undefined),
}))
vi.mock('../../../comments', () => ({
  CommentService: class {
    deleteCommentsByRecordId = h.deleteCommentsByRecordId
  },
}))

import { toRecordId } from '@auxx/types/resource'
import {
  createManifestCollector,
  type ManifestCollector,
} from '../../../record-rules/sync-manifest-collector'
import {
  archiveEntity,
  bulkArchiveEntities,
  createEntity,
  deleteEntity,
  type MutationContext,
} from '../unified-handler-mutations'
import { interactiveSession, seedSession, type WriteSession } from '../write-origin'

function syncSession(collector: ManifestCollector): WriteSession {
  return { origin: { kind: 'sync', source: 'import', ref: 'import_1', collector }, depth: 0 }
}

function ctx(session: WriteSession, fields: unknown[] = []): MutationContext {
  return {
    db: {} as never,
    organizationId: 'org_1',
    userId: 'user_1',
    session,
    fieldValueService: {} as never,
    resolveEntityDefinition: async () => ({
      id: 'def_1',
      entityType: 'contact',
      apiSlug: 'contacts',
    }),
    getFields: async () => fields as never,
    runPreHooks: async (_o, _d, values) => values,
    validateUniqueFields: async () => {},
    setFieldValues: async () => ({ failures: [], changed: true, changes: [], instance: null }),
  }
}

/** Minimal CustomField-shaped rows for the create path's field plumbing. */
function fieldRow(id: string, systemAttribute: string | null) {
  return { id, name: id, systemAttribute, required: false, isCreatable: true }
}

beforeEach(() => vi.clearAllMocks())

describe('tier-1 lifecycle capture — sync sessions', () => {
  it('createEntity records recordCreated with NO values when nothing subscribes, and stays silent', async () => {
    const collector = createManifestCollector({})

    await createEntity(ctx(syncSession(collector)), 'def_1', { first_name: 'Ada' })

    const manifest = collector.toJson()
    expect(manifest?.createdRecordIds).toEqual([toRecordId('def_1', 'inst_1')])
    expect(manifest?.createdValues).toBeUndefined()
    expect(manifest?.archivedRecordIds).toEqual([])
    // The silent lane's doors stay shut — capture is not a door.
    expect(h.publishLater).not.toHaveBeenCalled()
    expect(h.publish).not.toHaveBeenCalled()
  })

  it('createEntity captures createdValues (systemAttribute-keyed, raw) under a lifecycle created subscription', async () => {
    const collector = createManifestCollector({
      def_1: { fieldIds: new Set(), lifecycle: { created: true, deleted: false } },
    })
    const fields = [fieldRow('f1', 'first_name'), fieldRow('f2', null)]

    await createEntity(ctx(syncSession(collector), fields), 'def_1', {
      first_name: 'Ada',
      // No systemAttribute on f2 — must not appear in createdValues.
      f2: 'ignored',
    })

    const rid = toRecordId('def_1', 'inst_1')
    const manifest = collector.toJson()
    expect(manifest?.createdRecordIds).toEqual([rid])
    expect(manifest?.createdValues).toEqual({ [rid]: { first_name: 'Ada' } })
  })

  it('the engine createdValues win the double-capture window (collector dedupes first-seen)', async () => {
    const collector = createManifestCollector({
      def_1: { fieldIds: new Set(), lifecycle: { created: true, deleted: false } },
    })
    const fields = [fieldRow('f1', 'first_name')]

    await createEntity(ctx(syncSession(collector), fields), 'def_1', { first_name: 'Ada' })
    // The producer's post-create recordCreated (PR-1→PR-2 window) is a dupe —
    // first-seen wins, values included.
    collector.recordCreated(toRecordId('def_1', 'inst_1'), { first_name: 'stale-producer-copy' })

    const rid = toRecordId('def_1', 'inst_1')
    expect(collector.toJson()?.createdValues).toEqual({ [rid]: { first_name: 'Ada' } })
  })

  it('createEntity without a created subscription passes NO values even when fields carry systemAttributes', async () => {
    const collector = createManifestCollector({
      // Field subscription only — lifecycle.created stays false.
      def_1: { fieldIds: new Set(['f1']), lifecycle: { created: false, deleted: false } },
    })
    const fields = [fieldRow('f1', 'first_name')]

    await createEntity(ctx(syncSession(collector), fields), 'def_1', { first_name: 'Ada' })

    const manifest = collector.toJson()
    expect(manifest?.createdRecordIds).toEqual([toRecordId('def_1', 'inst_1')])
    expect(manifest?.createdValues).toBeUndefined()
  })

  it('archiveEntity records recordArchived', async () => {
    const collector = createManifestCollector({})

    await archiveEntity(ctx(syncSession(collector)), 'def_1:inst_1' as never)

    expect(collector.toJson()?.archivedRecordIds).toEqual(['def_1:inst_1'])
    expect(h.publishLater).not.toHaveBeenCalled()
  })

  it('deleteEntity records recordArchived (hard delete is membership too)', async () => {
    const collector = createManifestCollector({})

    await deleteEntity(ctx(syncSession(collector)), 'def_1:inst_1' as never)

    expect(collector.toJson()?.archivedRecordIds).toEqual(['def_1:inst_1'])
    expect(h.publishLater).not.toHaveBeenCalled()
  })

  it('bulkArchiveEntities feeds the collector per record — every id lands, once', async () => {
    const collector = createManifestCollector({})

    await bulkArchiveEntities(ctx(syncSession(collector)), [
      'def_1:inst_1' as never,
      // Same instance twice: the collector dedupes on the instance id.
      'def_1:inst_1' as never,
    ])

    expect(collector.toJson()?.archivedRecordIds).toEqual(['def_1:inst_1'])
  })
})

describe('tier-1 lifecycle capture — non-sync sessions record nothing', () => {
  it('seed and interactive sessions never reach a collector', async () => {
    // Nothing to capture INTO — the invariant here is that the ops run
    // unchanged with no collector in the session (no throw, doors per lane).
    await createEntity(ctx(seedSession('reshape')), 'def_1', {})
    await archiveEntity(ctx(seedSession('reshape')), 'def_1:inst_1' as never)
    expect(h.publishLater).not.toHaveBeenCalled()

    await archiveEntity(ctx(interactiveSession('user_1')), 'def_1:inst_1' as never)
    // Inline lane unchanged: bus event + realtime frame still fire.
    expect(h.publishLater).toHaveBeenCalledTimes(1)
    expect(h.publish).toHaveBeenCalledTimes(1)
  })
})
