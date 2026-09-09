// packages/lib/src/resources/crud/__tests__/bulk-delete-phases.test.ts
//
// `bulkDeleteEntities` runs in three phases (plans/records/bulk-delete-followups.md
// A.2, generalized over the relationship graph in
// plans/relationships/01-delete-semantics.md):
//
//   1. collect  — the closure: requested records plus everything their
//                 `onDelete: 'cascade'` relationships own, transitively;
//   2. refuse   — restrict relationships and pre-delete hooks, over the WHOLE
//                 closure, before any write; a refusal keeps the requested
//                 root's entire tree and reports the root;
//   3. write    — survivors only, deepest group first, set-based per chunk.
//
// The closure itself is covered by `delete-closure.test.ts` against a fake
// database. Here it is mocked with a fixture-driven stand-in so these tests
// pin what the phases do with it: ordering, pruning, attribution, the doors
// each record opens, and which of them a cascaded record does NOT open.

import { ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  /** parent instance id -> the children its cascade relationships own. */
  const children = new Map<string, Array<{ id: string; def: string }>>()
  /** Requested instance ids that resolve to no row. */
  const missing = new Set<string>()
  /** RecordId -> restrict violation, as `findRestrictViolations` would report it. */
  const restrict = new Map<string, { fieldLabel: string; count: number; error: Error }>()

  interface Node {
    recordId: string
    entityInstanceId: string
    def: string
    requestedBy: string | null
    depth: number
  }

  /**
   * A closure with the same contract as `collectDeleteClosure`: dedupe on the
   * instance id, requested records stay roots, a record reached twice keeps
   * the greater depth, groups deepest first and stable otherwise.
   */
  function closure(recordIds: readonly string[]) {
    const nodes = new Map<string, Node>()
    const notFound: string[] = []
    let frontier: Node[] = []
    for (const recordId of recordIds) {
      const [def, id] = recordId.split(':') as [string, string]
      if (nodes.has(id)) continue
      if (missing.has(id)) {
        notFound.push(recordId)
        continue
      }
      const node = { recordId, entityInstanceId: id, def, requestedBy: null, depth: 0 }
      nodes.set(id, node)
      frontier.push(node)
    }
    let depth = 0
    while (frontier.length > 0) {
      depth++
      const next: Node[] = []
      for (const parent of frontier) {
        for (const child of children.get(parent.entityInstanceId) ?? []) {
          const existing = nodes.get(child.id)
          if (existing) {
            existing.depth = Math.max(existing.depth, depth)
            continue
          }
          const node = {
            recordId: `${child.def}:${child.id}`,
            entityInstanceId: child.id,
            def: child.def,
            requestedBy: parent.recordId,
            depth,
          }
          nodes.set(child.id, node)
          next.push(node)
        }
      }
      frontier = next
    }
    const groups = new Map<
      string,
      { entityDefinitionId: string; apiSlug: string | null; depth: number; records: Node[] }
    >()
    for (const node of nodes.values()) {
      const group = groups.get(node.def) ?? {
        entityDefinitionId: node.def,
        apiSlug: null,
        depth: 0,
        records: [],
      }
      group.depth = Math.max(group.depth, node.depth)
      group.records.push(node)
      groups.set(node.def, group)
    }
    const ordered = [...groups.values()]
      .map((group, index) => ({ group, index }))
      .sort((a, b) => b.group.depth - a.group.depth || a.index - b.index)
      .map((entry) => entry.group)
    return { groups: ordered, notFound }
  }

  return {
    children,
    missing,
    restrict,
    closure,
    deleteEntityInstances: vi.fn(async (p: { ids: readonly string[] }) =>
      ok({ success: true, count: p.ids.length })
    ),
    deleteOpenPairsForRecords: vi.fn(async (_db: unknown, _org: string, _ids: readonly string[]) =>
      ok(0)
    ),
    deleteCommentsForDefinition: vi.fn(async (_def: string, _ids: readonly string[]) => {}),
    publish: vi.fn(async (_room: string, _event: string, ..._rest: unknown[]) => {}),
    publishLater: vi.fn(() => {}),
    getValues: vi.fn(async () => new Map()),
    /** slug -> hooks. */
    preDelete: new Map<string, Array<(e: never) => Promise<void>>>(),
    postDelete: new Map<string, Array<(e: never) => Promise<void>>>(),
  }
})

vi.mock('../delete-closure', async () => {
  const { ok } = await import('neverthrow')
  return {
    collectDeleteClosure: vi.fn(async (_db: unknown, p: { recordIds: readonly string[] }) =>
      ok(h.closure(p.recordIds))
    ),
    findRestrictViolations: vi.fn(async () => ok(new Map(h.restrict))),
  }
})
vi.mock('../../../field-hooks/registry', () => ({
  getEntityPreDeleteHooks: (slug: string) => h.preDelete.get(slug) ?? [],
  getEntityPostDeleteHooks: (slug: string) => h.postDelete.get(slug) ?? [],
  getEntityPreCreateHooks: () => [],
}))
vi.mock('../../../dedup/pairs', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  deleteOpenPairsForRecord: vi.fn(async () => ok(0)),
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
  deleteEntityInstances: h.deleteEntityInstances,
}))
vi.mock('../../../comments', () => ({
  CommentService: class {
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

import { BadRequestError, ConflictError } from '../../../errors'
import {
  bulkDeleteEntities,
  deleteEntity,
  type MutationContext,
} from '../unified-handler-mutations'
import { interactiveSession, quietSession, type WriteSession } from '../write-origin'

/** Definition key -> apiSlug, so a test can name a hooked definition. */
const SLUGS: Record<string, string> = {
  def_contacts: 'contacts',
  def_orders: 'orders',
  def_lines: 'line-items',
  def_allocs: 'allocations',
}

function ctx(session: WriteSession = interactiveSession('user_1', 'sock_1')): MutationContext {
  return {
    db: {} as never,
    organizationId: 'org_1',
    userId: 'user_1',
    socketId: 'sock_1',
    session,
    fieldValueService: {
      getValues: h.getValues,
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

/** The ids handed to the set-based delete, in call order: one entry per chunk. */
const deletedChunks = () => h.deleteEntityInstances.mock.calls.map((c) => c[0].ids)

/** An order that owns two lines through a cascade relationship. */
function orderWithLines() {
  h.children.set('order_1', [
    { id: 'line_1', def: 'def_lines' },
    { id: 'line_2', def: 'def_lines' },
  ])
}

beforeEach(() => {
  vi.clearAllMocks()
  h.children.clear()
  h.missing.clear()
  h.restrict.clear()
  h.preDelete.clear()
  h.postDelete.clear()
})

describe('phase 1: collect', () => {
  it('removes a definition with no cascades set-based, in one chunk', async () => {
    const result = await bulkDeleteEntities(ctx(), [
      'def_contacts:inst_1',
      'def_contacts:inst_2',
      'def_contacts:inst_3',
    ] as never[])

    expect(result).toEqual({ count: 3, errors: [] })
    expect(deletedChunks()).toEqual([['inst_1', 'inst_2', 'inst_3']])
  })

  it('reports a requested id that resolves to nothing, and deletes the rest', async () => {
    h.missing.add('ghost')

    const result = await bulkDeleteEntities(ctx(), [
      'def_contacts:ghost',
      'def_contacts:inst_1',
    ] as never[])

    expect(result.count).toBe(1)
    expect(result.errors).toEqual([
      { recordId: 'def_contacts:ghost', message: 'Entity not found: ghost', statusCode: undefined },
    ])
    expect(deletedChunks()).toEqual([['inst_1']])
  })

  it("deletes an order's cascaded children before the order, each exactly once", async () => {
    orderWithLines()

    const result = await bulkDeleteEntities(ctx(), ['def_orders:order_1'] as never[])

    // Cascaded records are removed but not counted: `count` stays bounded by
    // the request, as it was when the hook-driven cascade did this.
    expect(result).toEqual({ count: 1, errors: [] })
    expect(deletedChunks()).toEqual([['line_1', 'line_2'], ['order_1']])
    // Every removed record, cascaded or not, announces itself.
    expect(h.publish.mock.calls.map((c) => c[1])).toEqual([
      'record:deleted',
      'record:deleted',
      'record:deleted',
    ])
  })

  it('deletes a batch holding an order AND its own lines exactly once, with no Entity not found', async () => {
    // The D3 ordering rule from plans/records/bulk-delete-at-scale.md: the old
    // per-record cascade deleted the lines under the order and the loop then
    // failed to find them. The closure records each once, the requested line
    // keeps the deeper depth, and both are deleted in the lines group.
    orderWithLines()

    const result = await bulkDeleteEntities(ctx(), [
      'def_orders:order_1',
      'def_lines:line_1',
    ] as never[])

    expect(result).toEqual({ count: 2, errors: [] })
    expect(deletedChunks()).toEqual([['line_1', 'line_2'], ['order_1']])
  })

  it('runs deeper groups first and keeps the request order among the roots', async () => {
    h.children.set('order_1', [{ id: 'line_1', def: 'def_lines' }])

    await bulkDeleteEntities(ctx(), ['def_orders:order_1', 'def_contacts:contact_1'] as never[])

    expect(deletedChunks()).toEqual([['line_1'], ['order_1'], ['contact_1']])
  })
})

describe('phase 2: refuse, before any write', () => {
  it('refuses a restrict violation with its 409 and still deletes its neighbours', async () => {
    h.restrict.set('def_orders:order_1', {
      fieldLabel: 'builds',
      count: 2,
      error: new ConflictError(
        'This order has 2 builds. Remove them first, or archive the order instead.'
      ),
    })

    const result = await bulkDeleteEntities(ctx(), [
      'def_orders:order_1',
      'def_orders:order_2',
    ] as never[])

    expect(result.count).toBe(1)
    expect(result.errors).toEqual([
      {
        recordId: 'def_orders:order_1',
        message: 'This order has 2 builds. Remove them first, or archive the order instead.',
        statusCode: 409,
      },
    ])
    expect(deletedChunks()).toEqual([['order_2']])
  })

  it("a cascaded child's refusal prunes its subtree and refuses the requested root with the hook's status", async () => {
    orderWithLines()
    h.children.set('line_2', [{ id: 'alloc_1', def: 'def_allocs' }])
    const orderHook = vi.fn(async () => {})
    const lineHook = vi.fn(async (e: { recordId: string }) => {
      if (e.recordId.endsWith('line_2')) throw new BadRequestError('This line is allocated')
    })
    const allocHook = vi.fn(async () => {})
    h.preDelete.set('orders', [orderHook])
    h.preDelete.set('line-items', [lineHook])
    h.preDelete.set('allocations', [allocHook])

    const result = await bulkDeleteEntities(ctx(), [
      'def_orders:order_1',
      'def_contacts:contact_1',
    ] as never[])

    // The error is the ROOT's, carrying the child's message and status.
    expect(result.errors).toEqual([
      { recordId: 'def_orders:order_1', message: 'This line is allocated', statusCode: 400 },
    ])
    // Nothing in the order's tree was written; the unrelated record was.
    expect(result.count).toBe(1)
    expect(deletedChunks()).toEqual([['contact_1']])
    // Hooks ran shallowest first over the closure until the refusal pruned the
    // tree: the order, both lines, and NOT the allocation below the refused line.
    expect(orderHook).toHaveBeenCalledTimes(1)
    expect(lineHook).toHaveBeenCalledTimes(2)
    expect(allocHook).not.toHaveBeenCalled()
  })

  it('runs pre-delete hooks over cascaded records too, with their captured values', async () => {
    h.children.set('order_1', [{ id: 'line_1', def: 'def_lines' }])
    const lineHook = vi.fn(async (_e: { recordId: string; values: unknown }) => {})
    h.preDelete.set('line-items', [lineHook])

    await bulkDeleteEntities(ctx(), ['def_orders:order_1'] as never[])

    expect(lineHook).toHaveBeenCalledTimes(1)
    expect(lineHook.mock.calls[0]?.[0]).toMatchObject({
      recordId: 'def_lines:line_1',
      entitySlug: 'line-items',
      values: { hardDelete: true },
    })
  })

  it('a refused record keeps its comments and its duplicate pairs', async () => {
    // The whole safety argument of the phase split (followups A.2): batching
    // the belongings BEFORE the guards would delete what the guard just saved.
    h.preDelete.set('orders', [
      vi.fn(async (e: { recordId: string }) => {
        if (e.recordId.endsWith('order_2')) throw new BadRequestError('This order has a bill')
      }),
    ])

    await bulkDeleteEntities(ctx(), ['def_orders:order_1', 'def_orders:order_2'] as never[])

    expect(h.deleteCommentsForDefinition).toHaveBeenCalledTimes(1)
    expect(h.deleteCommentsForDefinition).toHaveBeenCalledWith('def_orders', ['order_1'])
    expect(h.deleteOpenPairsForRecords).toHaveBeenCalledTimes(1)
    expect(h.deleteOpenPairsForRecords.mock.calls[0]?.[2]).toEqual(['order_1'])
  })

  it('keeps a refusal per record, with its status code intact', async () => {
    // `bulkDeleteFailure` in the record router needs the status: an
    // INTERNAL_SERVER_ERROR has its message masked, so a guard rejection raised
    // as a 500 would reach the toast with no reason at all.
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
    expect(deletedChunks()).toEqual([['contact_1']])
  })
})

describe('phase 3: write, survivors only', () => {
  it('deletes comments and duplicate pairs once per definition, not once per record', async () => {
    await bulkDeleteEntities(ctx(), ['def_contacts:inst_1', 'def_contacts:inst_2'] as never[])

    expect(h.deleteCommentsForDefinition).toHaveBeenCalledTimes(1)
    expect(h.deleteCommentsForDefinition).toHaveBeenCalledWith('def_contacts', ['inst_1', 'inst_2'])
    expect(h.deleteOpenPairsForRecords).toHaveBeenCalledTimes(1)
    expect(h.deleteOpenPairsForRecords.mock.calls[0]?.[2]).toEqual(['inst_1', 'inst_2'])
  })

  it('keeps the tier-1 record:deleted frame and the bus event per record', async () => {
    // Unlike bulk ARCHIVE, delete must not collapse to a tier-2 delta frame:
    // the client removes these rows from the record store in place.
    await bulkDeleteEntities(ctx(), ['def_contacts:inst_1', 'def_contacts:inst_2'] as never[])

    expect(h.publish.mock.calls.map((c) => c[1])).toEqual(['record:deleted', 'record:deleted'])
    expect(h.publishLater).toHaveBeenCalledTimes(2)
  })

  it('runs post-delete hooks for requested records and not for cascaded ones', async () => {
    // Every registered post-delete hook re-projects the record's parent
    // document, and a cascaded record's parent is in the closure and dying.
    const linePostHook = vi.fn(async (_e: { recordId: string }) => {})
    h.postDelete.set('line-items', [linePostHook])
    h.children.set('order_1', [{ id: 'line_1', def: 'def_lines' }])

    await bulkDeleteEntities(ctx(), ['def_orders:order_1'] as never[])
    expect(linePostHook).not.toHaveBeenCalled()

    await bulkDeleteEntities(ctx(), ['def_lines:line_9'] as never[])
    expect(linePostHook).toHaveBeenCalledTimes(1)
    expect(linePostHook.mock.calls[0]?.[0]).toMatchObject({ recordId: 'def_lines:line_9' })
  })

  it('honours suppressPostDeleteHooks for a requested record whose caller runs the follow-up itself', async () => {
    const linePostHook = vi.fn(async () => {})
    h.postDelete.set('line-items', [linePostHook])

    await deleteEntity(ctx(), 'def_lines:line_9' as never, { suppressPostDeleteHooks: true })

    expect(linePostHook).not.toHaveBeenCalled()
    expect(deletedChunks()).toEqual([['line_9']])
  })

  it('attributes a failed chunk to the requested roots and keeps their parents', async () => {
    // The lines chunk's transaction rolled back, so the lines are still there.
    // Deleting the order over them would strand exactly the rows the cascade
    // exists to collect.
    orderWithLines()
    h.deleteEntityInstances.mockRejectedValueOnce(new Error('deadlock detected'))

    const result = await bulkDeleteEntities(ctx(), [
      'def_orders:order_1',
      'def_contacts:contact_1',
    ] as never[])

    expect(result.count).toBe(1)
    expect(result.errors).toEqual([
      { recordId: 'def_orders:order_1', message: 'deadlock detected', statusCode: undefined },
    ])
    expect(deletedChunks()).toEqual([['line_1', 'line_2'], ['contact_1']])
  })

  it('opens no doors and captures nothing on a quiet lane, but still cleans up', async () => {
    await bulkDeleteEntities(ctx(quietSession('connector teardown')), [
      'def_contacts:inst_1',
      'def_contacts:inst_2',
    ] as never[])

    expect(h.getValues).not.toHaveBeenCalled()
    expect(h.publish).not.toHaveBeenCalled()
    expect(h.publishLater).not.toHaveBeenCalled()
    // Data hygiene is not an event.
    expect(h.deleteOpenPairsForRecords).toHaveBeenCalledTimes(1)
    expect(h.deleteCommentsForDefinition).toHaveBeenCalledTimes(1)
  })

  it('captures per record on the event lane, so the deleted event carries its values', async () => {
    await bulkDeleteEntities(ctx(), ['def_contacts:inst_1', 'def_contacts:inst_2'] as never[])

    expect(h.getValues).toHaveBeenCalledTimes(2)
  })
})

describe('deleteEntity', () => {
  it('throws the original AuxxError instance, status intact', async () => {
    const refusal = new BadRequestError('This order has a bill')
    h.preDelete.set('orders', [
      vi.fn(async () => {
        throw refusal
      }),
    ])

    await expect(deleteEntity(ctx(), 'def_orders:order_1' as never)).rejects.toBe(refusal)
    expect(h.deleteEntityInstances).not.toHaveBeenCalled()
  })

  it('throws Entity not found for a record that resolves to nothing', async () => {
    h.missing.add('ghost')

    await expect(deleteEntity(ctx(), 'def_contacts:ghost' as never)).rejects.toThrow(
      'Entity not found: ghost'
    )
  })

  it('deletes one record through the same phases, cascade included', async () => {
    h.children.set('order_1', [{ id: 'line_1', def: 'def_lines' }])

    await expect(deleteEntity(ctx(), 'def_orders:order_1' as never)).resolves.toBeUndefined()

    expect(deletedChunks()).toEqual([['line_1'], ['order_1']])
  })
})
