// packages/lib/src/resources/crud/__tests__/bulk-delete-lanes.test.ts
//
// `bulkDeleteEntities` splits a batch by definition and sends each one down one
// of two lanes (plans/records/bulk-delete-at-scale.md §5.3):
//
//   guarded — per record, through `deleteEntity`, so pre/post-delete hooks run.
//   batched — set-based, ~4 statements per 500 records, for definitions the hook
//             registry says carry no delete hooks at all.
//
// The whole design rests on that registry answer being the ONLY thing that
// decides, so these tests pin the routing, the ordering between lanes, and the
// doors the batched lane still has to open by hand now that it no longer goes
// through `deleteEntity`.

import { ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  deleteEntityInstance: vi.fn(async (_p: { id: string; organizationId: string }) =>
    ok({ success: true })
  ),
  deleteEntityInstances: vi.fn(async (p: { ids: readonly string[] }) =>
    ok({ success: true, count: p.ids.length })
  ),
  deleteOpenPairsForRecord: vi.fn(async (_db: unknown, _org: string, _id: string) => ok(0)),
  deleteOpenPairsForRecords: vi.fn(async (_db: unknown, _org: string, _ids: readonly string[]) =>
    ok(0)
  ),
  deleteCommentsByRecordId: vi.fn(async () => {}),
  deleteCommentsForDefinition: vi.fn(async () => {}),
  publish: vi.fn(async (_room: string, _event: string, ..._rest: unknown[]) => {}),
  publishLater: vi.fn(() => {}),
  /** slug -> hooks. Empty map ⇒ every definition takes the batched lane. */
  preDelete: new Map<string, unknown[]>(),
  postDelete: new Map<string, unknown[]>(),
}))

vi.mock('../../../field-hooks/registry', () => ({
  getEntityPreDeleteHooks: (slug: string) => h.preDelete.get(slug) ?? [],
  getEntityPostDeleteHooks: (slug: string) => h.postDelete.get(slug) ?? [],
  getEntityPreCreateHooks: () => [],
}))
vi.mock('../../../dedup/pairs', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  deleteOpenPairsForRecord: h.deleteOpenPairsForRecord,
  deleteOpenPairsForRecords: h.deleteOpenPairsForRecords,
}))
vi.mock('../../../dedup/enqueue-scan', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  enqueueDuplicateScan: vi.fn(async () => 'job_1'),
}))
vi.mock('../../../entity-instances', () => ({
  getEntityInstance: vi.fn(async (p: { id: string }) => ok({ id: p.id, archivedAt: null })),
  getEntityInstanceRow: vi.fn(async () => ({ id: 'inst_1', archivedAt: null })),
  updateEntityInstance: vi.fn(async () => ok({ id: 'inst_1' })),
  createEntityInstance: vi.fn(async () => ok({ id: 'inst_1' })),
  archiveEntityInstances: vi.fn(async (p: { ids: readonly string[] }) => ok([...p.ids])),
  deleteEntityInstance: h.deleteEntityInstance,
  deleteEntityInstances: h.deleteEntityInstances,
}))
vi.mock('../../../comments', () => ({
  CommentService: class {
    deleteCommentsByRecordId = h.deleteCommentsByRecordId
    deleteCommentsForDefinition = h.deleteCommentsForDefinition
  },
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

import { bulkDeleteEntities, type MutationContext } from '../unified-handler-mutations'
import { interactiveSession, quietSession, type WriteSession } from '../write-origin'

/** Definition key -> apiSlug, so a test can name a hooked definition. */
const SLUGS: Record<string, string> = {
  def_contacts: 'contacts',
  def_orders: 'orders',
  def_lines: 'line-items',
}

function ctx(session: WriteSession = interactiveSession('user_1', 'sock_1')): MutationContext {
  return {
    db: {} as never,
    organizationId: 'org_1',
    userId: 'user_1',
    socketId: 'sock_1',
    session,
    // The guarded lane captures the record's values before deleting (the
    // deleted event carries relationship data entity triggers depend on), so
    // this needs a real enough shape to be called.
    fieldValueService: {
      getValues: async () => new Map(),
      ctx: { bypassFieldGuards: false },
    } as never,
    resolveEntityDefinition: async (entityDefinitionId: string) => ({
      id: entityDefinitionId,
      entityType: 'contact',
      apiSlug: SLUGS[entityDefinitionId] ?? entityDefinitionId,
    }),
    getFields: async () => [],
    runPreHooks: async (_o: unknown, _d: unknown, values: unknown) => values,
    validateUniqueFields: async () => {},
    setFieldValues: async () => [],
  } as never
}

/** The ids handed to the set-based delete, in call order. */
const batchedIds = () => h.deleteEntityInstances.mock.calls.map((c) => c[0].ids)

beforeEach(() => {
  vi.clearAllMocks()
  h.preDelete.clear()
  h.postDelete.clear()
})

describe('bulkDeleteEntities — lane routing', () => {
  it('sends a definition with NO delete hooks down the set-based lane', async () => {
    const result = await bulkDeleteEntities(ctx(), [
      'def_contacts:inst_1',
      'def_contacts:inst_2',
      'def_contacts:inst_3',
    ] as never[])

    expect(result).toEqual({ count: 3, errors: [] })
    expect(batchedIds()).toEqual([['inst_1', 'inst_2', 'inst_3']])
    // The per-record path is not touched at all.
    expect(h.deleteEntityInstance).not.toHaveBeenCalled()
  })

  it('sends a definition with a PRE-delete hook down the per-record lane', async () => {
    h.preDelete.set('orders', [vi.fn()])

    const result = await bulkDeleteEntities(ctx(), [
      'def_orders:inst_1',
      'def_orders:inst_2',
    ] as never[])

    expect(result.count).toBe(2)
    expect(h.deleteEntityInstances).not.toHaveBeenCalled()
    expect(h.deleteEntityInstance).toHaveBeenCalledTimes(2)
  })

  it('sends a definition with only a POST-delete hook down the per-record lane', async () => {
    // A post-delete hook re-projects something the record fed. Skipping it is
    // just as wrong as skipping a guard, so it decides the lane too.
    h.postDelete.set('contacts', [vi.fn()])

    await bulkDeleteEntities(ctx(), ['def_contacts:inst_1'] as never[])

    expect(h.deleteEntityInstances).not.toHaveBeenCalled()
    expect(h.deleteEntityInstance).toHaveBeenCalledTimes(1)
  })

  it('splits a mixed batch and runs cascaded children before their parents', async () => {
    h.preDelete.set('orders', [vi.fn()])
    h.preDelete.set('line-items', [vi.fn()])

    await bulkDeleteEntities(ctx(), [
      'def_orders:order_1',
      'def_contacts:contact_1',
      'def_lines:line_1',
    ] as never[])

    // Guarded records, in the order the lanes ran them.
    const guardedOrder = h.deleteEntityInstance.mock.calls.map((c) => c[0].id)
    expect(guardedOrder).toEqual(['line_1', 'order_1'])
    // And the batchable definition ran last, after both guarded ones.
    expect(batchedIds()).toEqual([['contact_1']])
  })
})

describe('bulkDeleteEntities — the batched lane opens its own doors', () => {
  it('deletes comments once per definition, not once per record', async () => {
    await bulkDeleteEntities(ctx(), ['def_contacts:inst_1', 'def_contacts:inst_2'] as never[])

    expect(h.deleteCommentsByRecordId).not.toHaveBeenCalled()
    expect(h.deleteCommentsForDefinition).toHaveBeenCalledTimes(1)
    expect(h.deleteCommentsForDefinition).toHaveBeenCalledWith('def_contacts', ['inst_1', 'inst_2'])
  })

  it('cleans up open duplicate pairs — the per-record delete never did', async () => {
    await bulkDeleteEntities(ctx(), ['def_contacts:inst_1', 'def_contacts:inst_2'] as never[])

    expect(h.deleteOpenPairsForRecords).toHaveBeenCalledTimes(1)
    expect(h.deleteOpenPairsForRecords.mock.calls[0]?.[2]).toEqual(['inst_1', 'inst_2'])
  })

  it('keeps the tier-1 record:deleted frame per record', async () => {
    // Unlike bulk ARCHIVE, delete must not collapse to a tier-2 delta frame:
    // the client removes these rows from the record store in place.
    await bulkDeleteEntities(ctx(), ['def_contacts:inst_1', 'def_contacts:inst_2'] as never[])

    const frames = h.publish.mock.calls.map((c) => c[1])
    expect(frames).toEqual(['record:deleted', 'record:deleted'])
    // And the bus event that timeline / rules / workflows ride, per record.
    expect(h.publishLater).toHaveBeenCalledTimes(2)
  })

  it('opens no doors at all on a quiet lane, but still cleans up', async () => {
    await bulkDeleteEntities(ctx(quietSession('connector teardown')), [
      'def_contacts:inst_1',
      'def_contacts:inst_2',
    ] as never[])

    expect(h.publish).not.toHaveBeenCalled()
    expect(h.publishLater).not.toHaveBeenCalled()
    // Data hygiene is not an event.
    expect(h.deleteOpenPairsForRecords).toHaveBeenCalledTimes(1)
    expect(h.deleteCommentsForDefinition).toHaveBeenCalledTimes(1)
  })
})

describe('bulkDeleteEntities — failures', () => {
  it('attributes a failed chunk to every record in it, announcing none', async () => {
    // The chunk's transaction rolled back, so no record in it was removed —
    // reporting a partial success nobody can act on would be a lie.
    h.deleteEntityInstances.mockRejectedValueOnce(new Error('deadlock detected'))

    const result = await bulkDeleteEntities(ctx(), [
      'def_contacts:inst_1',
      'def_contacts:inst_2',
    ] as never[])

    expect(result.count).toBe(0)
    expect(result.errors).toEqual([
      { recordId: 'def_contacts:inst_1', message: 'deadlock detected', statusCode: undefined },
      { recordId: 'def_contacts:inst_2', message: 'deadlock detected', statusCode: undefined },
    ])
    expect(h.publish).not.toHaveBeenCalled()
  })

  it('keeps a guarded refusal per record, with its status code intact', async () => {
    // `bulkDeleteFailure` in the record router needs the status: an
    // INTERNAL_SERVER_ERROR has its message masked, so a guard rejection raised
    // as a 500 would reach the toast with no reason at all.
    const { BadRequestError } = await import('../../../errors')
    h.preDelete.set('orders', [
      vi.fn(async (e: { recordId: string }) => {
        if (e.recordId.endsWith('order_2')) throw new BadRequestError('This order has a bill')
      }),
    ])

    const result = await bulkDeleteEntities(ctx(), [
      'def_orders:order_1',
      'def_orders:order_2',
    ] as never[])

    expect(result.count).toBe(1)
    expect(result.errors).toEqual([
      { recordId: 'def_orders:order_2', message: 'This order has a bill', statusCode: 400 },
    ])
  })

  it('does not let one definition failing stop the next one', async () => {
    h.preDelete.set('orders', [
      vi.fn(async () => {
        throw new Error('boom')
      }),
    ])

    const result = await bulkDeleteEntities(ctx(), [
      'def_orders:order_1',
      'def_contacts:contact_1',
    ] as never[])

    expect(result.count).toBe(1)
    expect(result.errors).toHaveLength(1)
    expect(batchedIds()).toEqual([['contact_1']])
  })
})
