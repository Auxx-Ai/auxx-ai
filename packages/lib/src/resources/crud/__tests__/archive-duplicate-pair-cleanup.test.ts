// packages/lib/src/resources/crud/__tests__/archive-duplicate-pair-cleanup.test.ts
//
// One property, and it is a placement property: the archive path's
// duplicate-pair cleanup sits OUTSIDE the `if (!options.skipEvents)` guard.
//
// Pair cleanup is data hygiene, not an event. In this product "delete" IS
// archive, so the FK cascade essentially never fires for a real record — and the
// bulk paths (`bulkArchiveEntities`, connector/import archives) are exactly the
// ones that pass `skipEvents: true`. A cleanup call nested in the event guard
// would therefore leak `open` pairs on precisely the highest-volume archive path
// while looking correct on the interactive one.
//
// The delete SQL itself (which statuses survive) is pinned against real SQL in
// `dedup/__tests__/archive-pair-cleanup.int.test.ts` — a fake db is
// predicate-blind.

import { ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  deleteOpenPairsForRecord: vi.fn(async () => ok(0)),
  enqueueDuplicateScan: vi.fn(async () => 'job_1'),
  publish: vi.fn(async () => {}),
  publishLater: vi.fn(() => {}),
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
}))
vi.mock('../../../events/publisher', () => ({
  publisher: { publishLater: h.publishLater, publish: h.publishLater },
}))

import { archiveEntity, type MutationContext } from '../unified-handler-mutations'
import { interactiveSession } from '../write-origin'

function ctx(): MutationContext {
  return {
    db: {} as never,
    organizationId: 'org_1',
    userId: 'user_1',
    session: interactiveSession('user_1'),
    fieldValueService: {} as never,
    resolveEntityDefinition: async () => ({
      id: 'def_1',
      entityType: 'contact',
      apiSlug: 'contacts',
    }),
    getFields: async () => [],
    runPreHooks: async (_o, _d, values) => values,
    validateUniqueFields: async () => {},
    setFieldValues: async () => [],
  }
}

beforeEach(() => vi.clearAllMocks())

describe('archiveEntity — duplicate-pair cleanup', () => {
  it('deletes the record’s open pairs on an interactive archive', async () => {
    await archiveEntity(ctx(), 'def_1:inst_1' as never)
    expect(h.deleteOpenPairsForRecord).toHaveBeenCalledTimes(1)
    expect(h.deleteOpenPairsForRecord).toHaveBeenCalledWith({}, 'org_1', 'inst_1')
  })

  it('still cleans up under skipEvents — this is the bulk-archive path', async () => {
    await archiveEntity(ctx(), 'def_1:inst_1' as never, { skipEvents: true })
    expect(h.publish).not.toHaveBeenCalled()
    expect(h.deleteOpenPairsForRecord).toHaveBeenCalledTimes(1)
  })

  it('does not fail the archive when cleanup throws', async () => {
    h.deleteOpenPairsForRecord.mockRejectedValueOnce(new Error('boom') as never)
    await expect(archiveEntity(ctx(), 'def_1:inst_1' as never)).resolves.toMatchObject({
      id: 'inst_1',
    })
  })

  it('does not enqueue a scan — archiving is not a reason to re-scan', async () => {
    await archiveEntity(ctx(), 'def_1:inst_1' as never)
    expect(h.enqueueDuplicateScan).not.toHaveBeenCalled()
  })
})
