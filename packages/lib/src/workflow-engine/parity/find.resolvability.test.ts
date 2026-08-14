// packages/lib/src/workflow-engine/parity/find.resolvability.test.ts

/**
 * Resolvability suite — Find node.
 *
 * Proves that every variable id `findManifest.resolveOutputs()` DECLARES for
 * a find node actually RESOLVES against a REAL `FindProcessor.executeNode` +
 * REAL `ExecutionContextManager.resolveVariablePath` run. See `harness.ts`
 * for the three invariants and `known-broken.ts` for the documented,
 * empirically-verified exceptions.
 *
 * REAL: `FindProcessor`, `ExecutionContextManager` (constructed for real,
 * never stubbed — that's the whole point: `resolveVariablePath`'s segment
 * walker has to actually run), `fetchResourceWithRelationships`,
 * `fetchResourceById` (both from `resources/resource-fetcher.ts` —
 * unmocked, they run for real against the mocked edges below).
 *
 * MOCKED (external edges only):
 * - `@auxx/database` — `schema.Thread`'s select chain resolves to a fixture
 *   row set (Tier A never goes through the entity/field-value machinery);
 *   `database.query.EntityInstance.findMany` for the custom-entity query lane.
 * - `../../cache` — `findCachedResource`/`getCachedResource`/
 *   `getCachedResources`/`getCachedResourceFields`, all backed by the same
 *   `ALL_RESOURCES` fixture (mirrors `find-output-keying.test.ts`'s pattern).
 * - `@auxx/services/entity-instances` — `getEntityInstance`, the actual DB
 *   read `fetchResourceById` sits behind. Backed by `VENDOR_INSTANCES`/
 *   `REGION_INSTANCES`.
 * - `../../field-values/field-value-queries` — `batchGetValues`, the actual
 *   DB read the record-field-cache lane (`getFieldValue`) sits behind.
 * - `../../permissions/visibility/automation-visibility` — thread queries
 *   always resolve automation visibility; stubbed to full org-inbox access.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowNode } from '../core/types'
import { WorkflowNodeType } from '../core/types'
import {
  ALL_RESOURCES,
  findFixtureResource,
  REGION_INSTANCES,
  resolveFixtureFieldPath,
  THREAD_RESOURCE,
  THREAD_ROW,
  THREAD_ROW_2,
  VENDOR_CREATE_INSTANCE_ID,
  VENDOR_DEF_ID,
  VENDOR_HIT_INSTANCE_ID,
  VENDOR_INSTANCES,
  VENDOR_RESOURCE,
  WORKFLOW_ID,
} from './fixtures'
import {
  assertResolvability,
  createContextManager,
  flattenDeclared,
  runExecuteNode,
  writtenKeysForNode,
} from './harness'

const { threadRows, entityFindMany } = vi.hoisted(() => ({
  threadRows: { current: [] as unknown[] },
  entityFindMany: vi.fn(async (): Promise<unknown[]> => []),
}))

vi.mock('@auxx/database', async () => {
  const { createChainableDatabaseMock, createSchemaMock } = await import('../../test/database-mock')
  const mockedSchema = createSchemaMock({ Thread: {}, EntityInstance: {}, FieldValue: {} })

  // Thread select chain — `find.ts`'s `executeThreadQuery` calls
  // `database.select().from(schema.Thread).$dynamic().where().orderBy()`,
  // then either `.limit(1)` (findOne) or the bare query (findMany) — both
  // awaited directly. This chain is its own thenable so both awaits resolve
  // to `threadRows.current`, set per-scenario below.
  const threadChain: Record<string, unknown> = {}
  threadChain.$dynamic = () => threadChain
  threadChain.where = () => threadChain
  threadChain.orderBy = () => threadChain
  threadChain.limit = () => threadChain
  // biome-ignore lint/suspicious/noThenProperty: deliberately thenable — see comment above
  threadChain.then = (resolve: (rows: unknown[]) => void) => resolve(threadRows.current)

  const db = new Proxy(
    {},
    {
      get: (_target, prop) => {
        if (prop === 'then') return undefined
        if (prop === 'select') {
          return () => ({
            from: (table: unknown) =>
              table === mockedSchema.Thread ? threadChain : createChainableDatabaseMock(),
          })
        }
        if (prop === 'query') {
          return {
            EntityInstance: { findMany: entityFindMany },
            FieldValue: { findMany: vi.fn(async () => []) },
          }
        }
        return createChainableDatabaseMock()
      },
    }
  )

  return { database: db, schema: mockedSchema }
})

// Full replacement, not a partial spread of the real module: the real
// `getCachedResourceFields` transitively hits `OrganizationCacheService` /
// `ResourceRegistryService`, which needs a real DB — exactly the kind of
// heavy graph `resources/resource-fetcher.ts`'s lazy-load path (real,
// unmocked here) reaches into.
vi.mock('../../cache', () => ({
  findCachedResource: vi.fn(
    async (_orgId: string, key: string) => findFixtureResource(key) ?? null
  ),
  getCachedResource: vi.fn(async (_orgId: string, key: string) => findFixtureResource(key) ?? null),
  getCachedResources: vi.fn(async () => ALL_RESOURCES),
  getCachedResourceFields: vi.fn(
    async (_orgId: string, key: string) => findFixtureResource(key)?.fields ?? []
  ),
}))

vi.mock('../../permissions/visibility/automation-visibility', () => ({
  getAutomationVisibility: vi.fn(async () => ({
    kind: 'automation' as const,
    personalInboxIds: {},
  })),
}))

vi.mock('@auxx/services/entity-instances', async () => {
  const { ok, err } = await import('neverthrow')
  return {
    getEntityInstance: vi.fn(
      async ({ id, organizationId: _organizationId }: { id: string; organizationId: string }) => {
        const found = VENDOR_INSTANCES[id] ?? REGION_INSTANCES[id]
        if (found) return ok(found)
        return err({
          code: 'ENTITY_INSTANCE_NOT_FOUND' as const,
          message: `not found: ${id}`,
          entityInstanceId: id,
        })
      }
    ),
  }
})

// Full replacement, not a partial spread of the real module: `batchGetValues`
// is the only export the code paths this suite exercises actually call
// (`ExecutionContextManager.getFieldValue`/`prefetchFields`), and the real
// module's own import graph (mail-lens-gate, resource-access grantee
// resolution, capability record-visibility) is exactly the kind of unrelated
// weight a full mock avoids pulling in.
vi.mock('../../field-values/field-value-queries', () => ({
  batchGetValues: vi.fn(
    async (
      _ctx: unknown,
      input: { recordIds: string[]; fieldReferences: (string | string[])[] }
    ) => ({
      values: input.recordIds.flatMap((recordId) =>
        input.fieldReferences.map((fieldRef) => {
          const segments = Array.isArray(fieldRef) ? fieldRef : [fieldRef]
          const typed = resolveFixtureFieldPath(segments, recordId)
          return {
            recordId,
            fieldRef,
            value: typed,
            fieldType: typed?.type === 'relationship' ? 'RELATIONSHIP' : 'TEXT',
          }
        })
      ),
    })
  ),
}))

const { FindProcessor } = await import('../nodes/action-nodes/find')
const { findManifest } = await import('../catalog/nodes/find')
// The SAME mock instance the `vi.mock` factory above created — import (not
// re-declare) it to assert call counts against the exact fn `getFieldValue`/
// `prefetchFields` call.
const { batchGetValues } = await import('../../field-values/field-value-queries')

function buildFindNode(nodeId: string, data: Record<string, unknown>): WorkflowNode {
  return {
    id: nodeId,
    workflowId: WORKFLOW_ID,
    nodeId,
    name: 'Find',
    type: WorkflowNodeType.FIND,
    data: {
      id: nodeId,
      type: WorkflowNodeType.FIND,
      title: 'Find',
      conditions: [],
      conditionGroups: [],
      orderBy: undefined,
      limit: undefined,
      ...data,
    },
    metadata: { position: { x: 0, y: 0 } },
  } as unknown as WorkflowNode
}

beforeEach(() => {
  entityFindMany.mockReset().mockResolvedValue([])
  threadRows.current = []
})

/** Runs the REAL FindProcessor (preprocess + execute) and returns written keys. */
async function runFind(nodeId: string, data: Record<string, unknown>) {
  const ctx = createContextManager(`exec_${nodeId}`)
  const node = buildFindNode(nodeId, data)
  const processor = new FindProcessor()
  const preprocessed = await processor.preprocessNode(node, ctx)
  const result = await runExecuteNode(processor, node, ctx, preprocessed)
  return { ctx, node, result, written: writtenKeysForNode(ctx, nodeId) }
}

describe('Find node resolvability', () => {
  it('findOne hit (custom entity Vendor) — declared ⊆ resolvable, written ⊆ declared, labels present', async () => {
    entityFindMany.mockResolvedValueOnce([
      {
        id: VENDOR_HIT_INSTANCE_ID,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-02'),
      },
    ])
    const nodeId = 'find_vendor_one'
    const { ctx, node, result, written } = await runFind(nodeId, {
      resourceType: VENDOR_DEF_ID,
      findMode: 'findOne',
      orderBy: { field: 'name', direction: 'asc' },
      limit: 5,
    })

    expect(result.status).toBe('succeeded')

    const declared = flattenDeclared(
      findManifest.resolveOutputs!(node.data as never, nodeId, {
        resource: VENDOR_RESOURCE,
        allResources: ALL_RESOURCES,
        resolveVariable: () => undefined,
      })
    )
    expect(declared.length).toBeGreaterThan(5)
    await assertResolvability(ctx, written, declared, 'find.findOne.hit.vendor')
  })

  it('findOne miss (custom entity Vendor) — root resolves to the written null; nested fields are structurally N/A', async () => {
    entityFindMany.mockResolvedValueOnce([])
    const nodeId = 'find_vendor_miss'
    const { ctx, result, written } = await runFind(nodeId, {
      resourceType: VENDOR_DEF_ID,
      findMode: 'findOne',
    })

    expect(result.status).toBe('succeeded')
    expect(written).toContain(`${nodeId}.${VENDOR_DEF_ID}`)

    // A stored `null` IS resolvable — `resolveVariablePath`'s direct lookup
    // only returns `undefined` for an ABSENT key, and this key is present.
    const root = await ctx.resolveVariablePath(`${nodeId}.${VENDOR_DEF_ID}`)
    expect(root).toBeNull()

    // Nested declared paths (`<node>.<defId>.name`, `.region`, …) are NOT
    // asserted here on purpose: with no record, `setEntityVariables` never
    // ran, so `<node>.<defId>` holds a bare `null`, not a `ResourceReference`
    // — there is nothing for the lazy-load ladder to walk. That is not a
    // resolvability BUG, it is what "not found" means; the full nested-tree
    // walk belongs to the hit scenario above, which is where it proves
    // something.
  })

  it('findOne (tier A thread) — declared ⊆ resolvable (with §3.2 pins), written ⊆ declared, labels present', async () => {
    threadRows.current = [THREAD_ROW]
    const nodeId = 'find_thread_one'
    const { ctx, node, result, written } = await runFind(nodeId, {
      resourceType: 'thread',
      findMode: 'findOne',
      orderBy: { field: 'subject', direction: 'asc' },
      limit: 5,
    })

    expect(result.status).toBe('succeeded')
    expect(written).toContain(`${nodeId}.thread`)

    const declared = flattenDeclared(
      findManifest.resolveOutputs!(node.data as never, nodeId, {
        resource: THREAD_RESOURCE,
        allResources: ALL_RESOURCES,
        resolveVariable: () => undefined,
      })
    )
    expect(declared.length).toBeGreaterThan(5)
    await assertResolvability(ctx, written, declared, 'find.findOne.thread')
  })

  it('findMany (custom entity Vendor) — declared ⊆ resolvable, written ⊆ declared, labels present', async () => {
    entityFindMany.mockResolvedValueOnce([
      {
        id: VENDOR_HIT_INSTANCE_ID,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-02'),
      },
      {
        id: VENDOR_CREATE_INSTANCE_ID,
        createdAt: new Date('2026-02-01'),
        updatedAt: new Date('2026-02-01'),
      },
    ])
    const nodeId = 'find_vendor_many'
    const { ctx, node, result, written } = await runFind(nodeId, {
      resourceType: VENDOR_DEF_ID,
      findMode: 'findMany',
      orderBy: { field: 'name', direction: 'asc' },
      limit: 5,
    })

    expect(result.status).toBe('succeeded')

    const declared = flattenDeclared(
      findManifest.resolveOutputs!(node.data as never, nodeId, {
        resource: VENDOR_RESOURCE,
        allResources: ALL_RESOURCES,
        resolveVariable: () => undefined,
      })
    )
    expect(declared.length).toBeGreaterThan(5)
    await assertResolvability(ctx, written, declared, 'find.findMany.vendor')
  })

  it('findMany (tier A thread) — declared ⊆ resolvable (with §3.2 pins), written ⊆ declared, labels present', async () => {
    threadRows.current = [THREAD_ROW, THREAD_ROW_2]
    const nodeId = 'find_thread_many'
    const { ctx, node, result, written } = await runFind(nodeId, {
      resourceType: 'thread',
      findMode: 'findMany',
      orderBy: { field: 'subject', direction: 'asc' },
      limit: 5,
    })

    expect(result.status).toBe('succeeded')

    const declared = flattenDeclared(
      findManifest.resolveOutputs!(node.data as never, nodeId, {
        resource: THREAD_RESOURCE,
        allResources: ALL_RESOURCES,
        resolveVariable: () => undefined,
      })
    )
    expect(declared.length).toBeGreaterThan(5)
    await assertResolvability(ctx, written, declared, 'find.findMany.thread')
  })

  // §11-segment-walk-resolver §8 additions — the deliberate behavior changes
  // §7 lists, each asserted directly (not just "resolves ⊆ declared").
  describe('segment-walk resolver — §7 behavior changes', () => {
    it("hop-2 relation path resolves to the SECOND hop's ACTUAL value (Vendor → region → parentRegion)", async () => {
      entityFindMany.mockResolvedValueOnce([
        {
          id: VENDOR_HIT_INSTANCE_ID,
          createdAt: new Date('2026-01-01'),
          updatedAt: new Date('2026-01-02'),
        },
      ])
      const nodeId = 'find_vendor_hop2'
      const { ctx, result } = await runFind(nodeId, {
        resourceType: VENDOR_DEF_ID,
        findMode: 'findOne',
      })
      expect(result.status).toBe('succeeded')

      // Was: the first hop's OWN value (`buildFieldPath`'s compounding bug —
      // reads a `RelationshipConfig` property that doesn't exist, falls back
      // to treating `region` as a direct field). Now: the real second-hop
      // field, hydrated by walking one relation at a time.
      const secondHop = await ctx.resolveVariablePath(
        `${nodeId}.${VENDOR_DEF_ID}.region.parentRegion.name`
      )
      expect(secondHop).toBe('Western Europe')

      // The first hop's own field must still resolve too (proves the walker
      // didn't just skip to hop 2 — both levels hydrate independently).
      const firstHop = await ctx.resolveVariablePath(`${nodeId}.${VENDOR_DEF_ID}.region.name`)
      expect(firstHop).toBe('EMEA')
    })

    it('`[*]` projects field VALUES, not raw rows (the tail-drop fix)', async () => {
      entityFindMany.mockResolvedValueOnce([
        {
          id: VENDOR_HIT_INSTANCE_ID,
          createdAt: new Date('2026-01-01'),
          updatedAt: new Date('2026-01-02'),
        },
        {
          id: VENDOR_CREATE_INSTANCE_ID,
          createdAt: new Date('2026-02-01'),
          updatedAt: new Date('2026-02-01'),
        },
      ])
      const nodeId = 'find_vendor_many_project'
      const { ctx } = await runFind(nodeId, { resourceType: VENDOR_DEF_ID, findMode: 'findMany' })

      // Was: `resolveNestedObject`'s `[*]`-early-return returned the raw
      // ResourceReference array untouched, discarding `.code`. Now: the
      // walker maps each item through the remaining path.
      const codes = await ctx.resolveVariablePath(`${nodeId}.vendors[*].code`)
      expect(codes).toEqual(['V-042', 'V-100'])

      const names = await ctx.resolveVariablePath(`${nodeId}.vendors[*].region.name`)
      expect(names).toEqual(['EMEA', null])
    })

    it('`[*].<scalar>` batches ONE batchGetValues call for N items (no N+1)', async () => {
      entityFindMany.mockResolvedValueOnce([
        {
          id: VENDOR_HIT_INSTANCE_ID,
          createdAt: new Date('2026-01-01'),
          updatedAt: new Date('2026-01-02'),
        },
        {
          id: VENDOR_CREATE_INSTANCE_ID,
          createdAt: new Date('2026-02-01'),
          updatedAt: new Date('2026-02-01'),
        },
      ])
      const nodeId = 'find_vendor_many_batch'
      const { ctx } = await runFind(nodeId, { resourceType: VENDOR_DEF_ID, findMode: 'findMany' })

      vi.mocked(batchGetValues).mockClear()
      const codes = await ctx.resolveVariablePath(`${nodeId}.vendors[*].code`)

      expect(codes).toEqual(['V-042', 'V-100'])
      // Was: one `batchGetValues` call PER ITEM (`resolveFieldFromResourceRef`
      // run inside the array-map branch). Now: `walkProjection` prefetches
      // every item's field in one call before mapping the walk.
      expect(batchGetValues).toHaveBeenCalledOnce()
    })
  })
})
