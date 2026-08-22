// packages/lib/src/resources/crud/__tests__/bulk-archive-records-changed.test.ts
//
// D-17/§7b realtime slice (plan events/03): `bulkArchiveEntities` is
// bulk-shaped, so its realtime door is tier 2 — ONE `records:changed` delta
// frame per def (ids only, publisher chunks at 100) instead of N per-record
// `record:archived` frames. Everything else about the per-record loop is
// unchanged: bus events (timeline / rules / workflows ride them) and
// duplicate-pair cleanup still fire once per record, and the single-record
// `archiveEntity` path keeps its tier-1 frame exactly as before.
//
// Under a silent lane (seed/sync session, or the deprecated `skipEvents`
// alias) NOTHING is emitted — the per-record frames were already suppressed
// there, and the finalize pass owns sync realtime, so no tier-2 frame either.

import { ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  deleteOpenPairsForRecord: vi.fn(async () => ok(0)),
  enqueueDuplicateScan: vi.fn(async () => 'job_1'),
  publish: vi.fn(async () => {}),
  publishLater: vi.fn(() => {}),
  publishRecordsChanged: vi.fn(async () => {}),
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
  getEntityInstance: vi.fn(async () => ok({ id: 'inst_1', archivedAt: null })),
  updateEntityInstance: vi.fn(async () => ok({ id: 'inst_1' })),
  createEntityInstance: vi.fn(async () => ok({ id: 'inst_1' })),
  deleteEntityInstance: vi.fn(async () => ok({ id: 'inst_1' })),
}))
vi.mock('../../../realtime', () => ({
  getRealtimeService: () => ({ publish: h.publish }),
  rooms: { orgRecords: () => 'room' },
  publishRecordsChanged: h.publishRecordsChanged,
}))
vi.mock('../../../events/publisher', () => ({
  publisher: { publishLater: h.publishLater, publish: h.publishLater },
}))

import {
  archiveEntity,
  bulkArchiveEntities,
  type MutationContext,
} from '../unified-handler-mutations'
import { interactiveSession, seedSession, type WriteSession } from '../write-origin'

function ctx(session: WriteSession = interactiveSession('user_1', 'sock_1')): MutationContext {
  return {
    db: {} as never,
    organizationId: 'org_1',
    userId: 'user_1',
    socketId: 'sock_1',
    session,
    fieldValueService: {} as never,
    resolveEntityDefinition: async (entityDefinitionId: string) => ({
      id: entityDefinitionId,
      entityType: 'contact',
      apiSlug: 'contacts',
    }),
    getFields: async () => [],
    runPreHooks: async (_o, _d, values) => values,
    validateUniqueFields: async () => {},
    setFieldValues: async () => {},
  } as never
}

/** Every realtime frame name published through the tier-1 service spy. */
const publishedFrames = () => h.publish.mock.calls.map((c) => String((c as unknown[])[1]))

beforeEach(() => vi.clearAllMocks())

describe('bulkArchiveEntities — tier-2 records:changed (D-17/§7b)', () => {
  it('emits zero record:archived frames and one records:changed publish carrying all ids', async () => {
    const recordIds = ['def_1:inst_1', 'def_1:inst_2', 'def_1:inst_3'] as never[]
    const result = await bulkArchiveEntities(ctx(), recordIds)

    expect(result.count).toBe(3)
    expect(publishedFrames()).not.toContain('record:archived')

    expect(h.publishRecordsChanged).toHaveBeenCalledTimes(1)
    const [, organizationId, args, options] = h.publishRecordsChanged.mock.calls[0] as [
      unknown,
      string,
      { entityDefinitionId: string; entries: Array<{ recordId: string }> },
      { excludeSocketId?: string },
    ]
    expect(organizationId).toBe('org_1')
    expect(args.entityDefinitionId).toBe('def_1')
    expect(args.entries.map((e) => e.recordId)).toEqual(['inst_1', 'inst_2', 'inst_3'])
    // Same self-echo exclusion the per-record frames carried.
    expect(options).toEqual({ excludeSocketId: 'sock_1' })
  })

  it('publishes one delta frame per def when the batch spans defs', async () => {
    const recordIds = ['def_1:inst_1', 'def_2:inst_2', 'def_1:inst_3'] as never[]
    await bulkArchiveEntities(ctx(), recordIds)

    expect(h.publishRecordsChanged).toHaveBeenCalledTimes(2)
    const byDef = new Map(
      h.publishRecordsChanged.mock.calls.map((c) => {
        const args = (c as unknown[])[2] as {
          entityDefinitionId: string
          entries: Array<{ recordId: string }>
        }
        return [args.entityDefinitionId, args.entries.map((e) => e.recordId)] as const
      })
    )
    expect(byDef.get('def_1')).toEqual(['inst_1', 'inst_3'])
    expect(byDef.get('def_2')).toEqual(['inst_2'])
  })

  it('keeps every other per-record door: bus events and pair cleanup fire once per record', async () => {
    const recordIds = ['def_1:inst_1', 'def_1:inst_2', 'def_1:inst_3'] as never[]
    await bulkArchiveEntities(ctx(), recordIds)

    // Bus event (timeline / rules / workflow dispatch hang off it): per record.
    expect(h.publishLater).toHaveBeenCalledTimes(3)
    // Duplicate-pair cleanup (outside the event guard): per record.
    expect(h.deleteOpenPairsForRecord).toHaveBeenCalledTimes(3)
  })

  it('emits NOTHING under a seed session — the silent lane stays silent', async () => {
    await bulkArchiveEntities(ctx(seedSession('test')), ['def_1:inst_1', 'def_1:inst_2'] as never[])

    expect(h.publish).not.toHaveBeenCalled()
    expect(h.publishRecordsChanged).not.toHaveBeenCalled()
    expect(h.publishLater).not.toHaveBeenCalled()
    // Data hygiene is not an event: cleanup still runs per record.
    expect(h.deleteOpenPairsForRecord).toHaveBeenCalledTimes(2)
  })

  it('emits NOTHING under the deprecated skipEvents alias either', async () => {
    await bulkArchiveEntities(ctx(), ['def_1:inst_1'] as never[], { skipEvents: true })

    expect(h.publish).not.toHaveBeenCalled()
    expect(h.publishRecordsChanged).not.toHaveBeenCalled()
  })

  it('a failed record is skipped: not counted and not in the delta frame', async () => {
    const { getEntityInstance } = await import('../../../entity-instances')
    ;(getEntityInstance as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(ok({ id: 'inst_1', archivedAt: null }))
      .mockRejectedValueOnce(new Error('boom'))

    const result = await bulkArchiveEntities(ctx(), ['def_1:inst_1', 'def_1:inst_2'] as never[])
    expect(result.count).toBe(1)
    const args = (h.publishRecordsChanged.mock.calls[0] as unknown[])[2] as {
      entries: Array<{ recordId: string }>
    }
    expect(args.entries.map((e) => e.recordId)).toEqual(['inst_1'])
  })
})

describe('archiveEntity — single-record path is untouched', () => {
  it('still publishes the per-record record:archived tier-1 frame', async () => {
    await archiveEntity(ctx(), 'def_1:inst_1' as never)

    expect(publishedFrames()).toContain('record:archived')
    expect(h.publish).toHaveBeenCalledWith(
      'room',
      'record:archived',
      { recordId: 'def_1:inst_1', entityDefinitionId: 'def_1' },
      { excludeSocketId: 'sock_1' }
    )
    expect(h.publishRecordsChanged).not.toHaveBeenCalled()
  })
})
