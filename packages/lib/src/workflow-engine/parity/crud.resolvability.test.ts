// packages/lib/src/workflow-engine/parity/crud.resolvability.test.ts

/**
 * Resolvability suite — CRUD node.
 *
 * Proves that every variable id `crudManifest.resolveOutputs()` DECLARES for
 * a crud node actually RESOLVES against a REAL `CrudNodeProcessor.executeNode`
 * + REAL `ExecutionContextManager.resolveVariablePath` run. See `harness.ts`
 * for the three invariants and `known-broken.ts` for the documented,
 * empirically-verified exceptions.
 *
 * REAL: `CrudNodeProcessor`, `ExecutionContextManager` (never stubbed),
 * `fetchResourceWithRelationships`, `fetchResourceById` — same as
 * `find.resolvability.test.ts`.
 *
 * MOCKED (external edges only):
 * - `../../resources/crud` — `UnifiedCrudHandler`. Mirrors
 *   `crud-canonicalization.test.ts`/`crud-delete-variables.test.ts`: the
 *   actual create/update/archive DB writes are not what this suite is about
 *   — the OUTPUT KEYING and its resolvability is.
 * - `../../cache` — same fixture-backed resource lookups as the find suite.
 * - `@auxx/services/entity-instances` — `getEntityInstance`, backing the
 *   post-write lazy-load ladder for create/update's field paths.
 * - `../../field-values/field-value-queries` — `batchGetValues`.
 * - `../../threads/thread-mutation.service` — `ThreadMutationService`, for
 *   the thread-actions scenario. Only `.update()` is exercised (the
 *   scenario's `data` sets only `status`/`subject`, so `UnreadService` and
 *   `threads/links.service` are never reached — genuinely unmocked, not
 *   silently inert).
 * - `../../permissions/visibility/automation-visibility` — thread mode
 *   resolves automation visibility unconditionally.
 * - `@auxx/database` — ONLY needed because resolving the bare `<node>.thread`
 *   reference (the thread-actions scenario's declared root) still triggers a
 *   full lazy-load hydration: the segment walker's base-resolution step
 *   matches a stored `ResourceReference` even with an EMPTY remaining path, so
 *   `resolveVariablePath('<node>.thread')` calls `fetchResourceWithRelationships`
 *   → `fetchResourceById` → (system resource) `executeResourceQuery` →
 *   `database.select().from(schema.Thread)`, which needs a real `PgTable`
 *   identity check (`resolveSchemaTable`'s `is(table, PgTable)`) the plain
 *   `{}` schema proxy in `src/test/setup.ts` fails. Same `Thread`-chain
 *   pattern as `find.resolvability.test.ts`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowNode } from '../core/types'
import { WorkflowNodeType } from '../core/types'
import {
  ALL_RESOURCES,
  findFixtureResource,
  REGION_INSTANCES,
  resolveFixtureFieldPath,
  THREAD_HIT_ID,
  THREAD_ROW,
  VENDOR_CREATE_INSTANCE_ID,
  VENDOR_DEF_ID,
  VENDOR_DELETE_INSTANCE_ID,
  VENDOR_INSTANCES,
  VENDOR_RESOURCE,
  VENDOR_UPDATE_INSTANCE_ID,
  WORKFLOW_ID,
} from './fixtures'
import {
  assertLabelCoverage,
  assertResolvability,
  assertWrittenCovered,
  createContextManager,
  flattenDeclared,
  runExecuteNode,
  writtenKeysForNode,
} from './harness'

const { threadRows } = vi.hoisted(() => ({ threadRows: { current: [] as unknown[] } }))

vi.mock('@auxx/database', async () => {
  const { createChainableDatabaseMock, createSchemaMock } = await import('../../test/database-mock')
  const mockedSchema = createSchemaMock({ Thread: {}, EntityInstance: {}, FieldValue: {} })

  const threadChain: Record<string, unknown> = {}
  threadChain.$dynamic = () => threadChain
  threadChain.where = () => threadChain
  threadChain.orderBy = () => threadChain
  threadChain.limit = () => threadChain
  // biome-ignore lint/suspicious/noThenProperty: deliberately thenable — mimics the Drizzle query builder's own then()
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
            EntityInstance: { findMany: vi.fn(async () => []) },
            FieldValue: { findMany: vi.fn(async () => []) },
          }
        }
        return createChainableDatabaseMock()
      },
    }
  )

  return { database: db, schema: mockedSchema }
})

// `fetchResourceById` (resources/resource-fetcher.ts) builds its WHERE clause
// via `resolveSchemaTable(tableInfo.dbName)`, which runs drizzle-orm's `is(table,
// PgTable)` — a REAL runtime brand check nothing but an actual `pgTable(...)`
// output can pass, so no plain mock object for `schema.Thread` can satisfy it.
// This is the one seam that has to be mocked directly (a cross-module import,
// unlike `executeResourceQuery` which `fetchResourceById` calls in the SAME
// file and which `vi.mock` therefore cannot intercept for that internal call).
vi.mock('../../resources/schema-table', () => ({
  resolveSchemaTable: vi.fn(() => ({ id: {} })),
  requireColumn: vi.fn((table: Record<string, unknown>, key: string) => table[key] ?? {}),
}))

const { createWithValues, updateValues, archive, threadUpdate } = vi.hoisted(() => ({
  createWithValues: vi.fn(async () => ({ entityInstance: {}, id: '' })),
  updateValues: vi.fn(async () => ({ entityInstance: {}, id: '' })),
  archive: vi.fn(async () => undefined),
  threadUpdate: vi.fn(async () => ({
    id: '',
    success: true,
    updatedFields: {},
    timestamp: new Date(),
  })),
}))

vi.mock('../../resources/crud', () => ({
  UnifiedCrudHandler: class {
    createWithValues = createWithValues
    updateValues = updateValues
    archive = archive
  },
}))

// Full replacement — see the doc comment above for why `@auxx/database`
// itself is left unmocked; this and `getEntityInstance`/`batchGetValues`
// below are the only real DB-adjacent edges this suite's CRUD paths touch.
vi.mock('../../cache', () => ({
  findCachedResource: vi.fn(
    async (_orgId: string, key: string) => findFixtureResource(key) ?? null
  ),
  getCachedResource: vi.fn(async (_orgId: string, key: string) => findFixtureResource(key) ?? null),
  getCachedResources: vi.fn(async () => ALL_RESOURCES),
  getCachedResourceFields: vi.fn(
    async (_orgId: string, key: string) => findFixtureResource(key)?.fields ?? []
  ),
  requireCachedEntityDefId: vi.fn(async (_orgId: string, entityType: string) => entityType),
}))

vi.mock('@auxx/services/entity-instances', async () => {
  const { ok, err } = await import('neverthrow')
  return {
    getEntityInstance: vi.fn(async ({ id }: { id: string; organizationId: string }) => {
      const found = VENDOR_INSTANCES[id] ?? REGION_INSTANCES[id]
      if (found) return ok(found)
      return err({
        code: 'ENTITY_INSTANCE_NOT_FOUND' as const,
        message: `not found: ${id}`,
        entityInstanceId: id,
      })
    }),
  }
})

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

vi.mock('../../permissions/visibility/automation-visibility', () => ({
  getAutomationVisibility: vi.fn(async () => ({
    kind: 'automation' as const,
    personalInboxIds: {},
  })),
}))

vi.mock('../../threads/thread-mutation.service', () => ({
  ThreadMutationService: class {
    update = threadUpdate
  },
}))

const { CrudNodeProcessor } = await import('../nodes/action-nodes/crud')
const { crudManifest, CrudErrorStrategy } = await import('../catalog/nodes/crud')

function buildCrudNode(nodeId: string, data: Record<string, unknown>): WorkflowNode {
  return {
    id: nodeId,
    workflowId: WORKFLOW_ID,
    nodeId,
    name: 'CRUD',
    type: WorkflowNodeType.CRUD,
    data: {
      id: nodeId,
      type: WorkflowNodeType.CRUD,
      title: 'CRUD',
      data: {},
      error_strategy: CrudErrorStrategy.fail,
      default_values: [],
      ...data,
    },
    metadata: { position: { x: 0, y: 0 } },
  } as unknown as WorkflowNode
}

beforeEach(() => {
  createWithValues.mockReset()
  updateValues.mockReset()
  archive.mockReset().mockResolvedValue(undefined)
  threadUpdate
    .mockReset()
    .mockResolvedValue({ id: 'x', success: true, updatedFields: {}, timestamp: new Date() })
  threadRows.current = []
})

/** Runs the REAL CrudNodeProcessor (preprocess + execute) and returns written keys. */
async function runCrud(nodeId: string, data: Record<string, unknown>) {
  const ctx = createContextManager(`exec_${nodeId}`)
  const node = buildCrudNode(nodeId, data)
  const processor = new CrudNodeProcessor()
  const preprocessed = await processor.preprocessNode(node, ctx)
  const result = await runExecuteNode(processor, node, ctx, preprocessed)
  return { ctx, node, result, written: writtenKeysForNode(ctx, nodeId) }
}

describe('CRUD node resolvability', () => {
  it('create (custom entity Vendor) — declared ⊆ resolvable, written ⊆ declared, labels present', async () => {
    createWithValues.mockResolvedValueOnce({
      entityInstance: {
        id: VENDOR_CREATE_INSTANCE_ID,
        entityDefinitionId: VENDOR_DEF_ID,
        createdAt: new Date('2026-02-01'),
        updatedAt: new Date('2026-02-01'),
      },
      id: VENDOR_CREATE_INSTANCE_ID,
    })
    const nodeId = 'crud_vendor_create'
    const { ctx, node, result, written } = await runCrud(nodeId, {
      resourceType: VENDOR_DEF_ID,
      mode: 'create',
      data: { name: 'Globex Parts', code: 'V-100' },
    })

    expect(result.status).toBe('succeeded')

    const declared = flattenDeclared(
      crudManifest.resolveOutputs!(node.data as never, nodeId, {
        resource: VENDOR_RESOURCE,
        allResources: ALL_RESOURCES,
        resolveVariable: () => undefined,
      })
    )
    expect(declared.length).toBeGreaterThan(5)
    await assertResolvability(ctx, written, declared, 'crud.create.vendor')
    // Retires the former `crudSuccessErrorDetailsPin` (known-broken.ts):
    // `errorDetails` is declared unconditionally, and now the success path
    // writes it to `null` next to `error: null`, same as the failure path
    // (`handleCrudError`) already did.
    expect(await ctx.resolveVariablePath(`${nodeId}.errorDetails`)).toBeNull()
  })

  it('update (custom entity Vendor) — declared ⊆ resolvable, written ⊆ declared, labels present', async () => {
    updateValues.mockResolvedValueOnce({
      entityInstance: {
        id: VENDOR_UPDATE_INSTANCE_ID,
        entityDefinitionId: VENDOR_DEF_ID,
        createdAt: new Date('2026-01-15'),
        updatedAt: new Date('2026-02-15'),
      },
      id: VENDOR_UPDATE_INSTANCE_ID,
    })
    const nodeId = 'crud_vendor_update'
    const { ctx, node, result, written } = await runCrud(nodeId, {
      resourceType: VENDOR_DEF_ID,
      mode: 'update',
      resourceId: VENDOR_UPDATE_INSTANCE_ID,
      data: { name: 'Initech Supply', code: 'V-200' },
    })

    expect(result.status).toBe('succeeded')

    const declared = flattenDeclared(
      crudManifest.resolveOutputs!(node.data as never, nodeId, {
        resource: VENDOR_RESOURCE,
        allResources: ALL_RESOURCES,
        resolveVariable: () => undefined,
      })
    )
    expect(declared.length).toBeGreaterThan(5)
    await assertResolvability(ctx, written, declared, 'crud.update.vendor')
    expect(await ctx.resolveVariablePath(`${nodeId}.errorDetails`)).toBeNull()
  })

  it('delete (custom entity Vendor) — declared ⊆ resolvable, written ⊆ declared, labels present', async () => {
    const nodeId = 'crud_vendor_delete'
    const { ctx, node, result, written } = await runCrud(nodeId, {
      resourceType: VENDOR_DEF_ID,
      mode: 'delete',
      resourceId: VENDOR_DELETE_INSTANCE_ID,
    })

    expect(result.status).toBe('succeeded')
    expect(archive).toHaveBeenCalledOnce()
    // Pins #1584: delete must still write `deleted`/`id` — the fix this
    // suite exists to keep proven. If a regression removed the writes, this
    // scenario's `assertResolvability` below would fail on the declared
    // `deleted`/`id` ids resolving to `undefined`.
    expect(written).toContain(`${nodeId}.deleted`)
    expect(written).toContain(`${nodeId}.id`)

    const declared = flattenDeclared(
      crudManifest.resolveOutputs!(node.data as never, nodeId, {
        resource: VENDOR_RESOURCE,
        allResources: ALL_RESOURCES,
        resolveVariable: () => undefined,
      })
    )
    await assertResolvability(ctx, written, declared, 'crud.delete.vendor')
    expect(await ctx.resolveVariablePath(`${nodeId}.errorDetails`)).toBeNull()
  })

  it('thread-actions update — declared ⊆ resolvable, written ⊆ declared, labels present', async () => {
    threadRows.current = [THREAD_ROW]
    const nodeId = 'crud_thread_update'
    const { ctx, node, result, written } = await runCrud(nodeId, {
      resourceType: 'thread',
      mode: 'update',
      resourceId: THREAD_HIT_ID,
      data: { status: 'CLOSED', subject: 'Escalated: shipment delay' },
    })

    expect(result.status).toBe('succeeded')
    expect(threadUpdate).toHaveBeenCalledOnce()

    const declared = flattenDeclared(
      crudManifest.resolveOutputs!(node.data as never, nodeId, {
        resource: undefined,
        allResources: ALL_RESOURCES,
        resolveVariable: () => undefined,
      })
    )
    expect(declared.length).toBeGreaterThan(10)
    await assertResolvability(ctx, written, declared, 'crud.thread.update')
    expect(await ctx.resolveVariablePath(`${nodeId}.errorDetails`)).toBeNull()
  })

  it('error_strategy "default" — usedDefaults/defaultValues resolve after a forced failure', async () => {
    updateValues.mockRejectedValueOnce(new Error('simulated update failure'))
    const nodeId = 'crud_vendor_update_default'
    const { ctx, node, result, written } = await runCrud(nodeId, {
      resourceType: VENDOR_DEF_ID,
      mode: 'update',
      resourceId: VENDOR_UPDATE_INSTANCE_ID,
      data: { name: 'Initech Supply' },
      error_strategy: CrudErrorStrategy.default,
      default_values: [{ key: 'fallbackNote', type: 'string', value: 'applied fallback' }],
    })

    // `default` with configured default_values still SUCCEEDS the node
    // (`handleCrudError`'s 'default' case returns `NodeRunningStatus.Succeeded`).
    expect(result.status).toBe('succeeded')
    expect(written).toContain(`${nodeId}.usedDefaults`)
    expect(written).toContain(`${nodeId}.defaultValues`)

    const declared = flattenDeclared(
      crudManifest.resolveOutputs!(node.data as never, nodeId, {
        resource: VENDOR_RESOURCE,
        allResources: ALL_RESOURCES,
        resolveVariable: () => undefined,
      })
    )
    expect(declared.map((d) => d.id)).toContain(`${nodeId}.usedDefaults`)
    expect(declared.map((d) => d.id)).toContain(`${nodeId}.defaultValues`)

    // Deliberately NOT the full `assertResolvability` walk, same reasoning as
    // find's findOne-miss scenario: the update genuinely FAILED, so
    // `setEntityVariables` never ran and the declared `<node>.<defId>` /
    // `<node>.record` / `<node>.id` tree — which the manifest still declares
    // unconditionally whenever the resource has visible fields, regardless of
    // error_strategy — has NOTHING written under it at all (not even a
    // sentinel `null`, unlike find's miss case). That is not a resolvability
    // BUG; it is what "the write never happened" means. This scenario exists
    // to prove `usedDefaults`/`defaultValues` specifically, which is what the
    // task's self-check names — assert those and the label/write-coverage
    // invariants directly instead of over-scoping to the full tree.
    assertLabelCoverage(declared, 'crud.update.default-strategy')
    assertWrittenCovered(written, declared, 'crud.update.default-strategy')
    expect(await ctx.resolveVariablePath(`${nodeId}.usedDefaults`)).toBe(true)
    expect(await ctx.resolveVariablePath(`${nodeId}.defaultValues`)).toEqual({
      fallbackNote: 'applied fallback',
    })
  })

  it('error_strategy "default" with no default_values configured — falls through to fail, but usedDefaults/defaultValues still resolve', async () => {
    updateValues.mockRejectedValueOnce(new Error('simulated update failure'))
    const nodeId = 'crud_vendor_update_default_empty'
    const { ctx, node, result, written } = await runCrud(nodeId, {
      resourceType: VENDOR_DEF_ID,
      mode: 'update',
      resourceId: VENDOR_UPDATE_INSTANCE_ID,
      data: { name: 'Initech Supply' },
      error_strategy: CrudErrorStrategy.default,
      default_values: [],
    })

    // No default_values configured — `handleCrudError`'s 'default' case falls
    // through to 'fail' (see the `crud.ts` comment above that fall-through).
    expect(result.status).toBe('failed')
    // Both are declared unconditionally whenever error_strategy === 'default',
    // same as the configured-defaults scenario above — the fall-through must
    // not leave them permanently unresolvable.
    expect(written).toContain(`${nodeId}.usedDefaults`)
    expect(written).toContain(`${nodeId}.defaultValues`)

    const declared = flattenDeclared(
      crudManifest.resolveOutputs!(node.data as never, nodeId, {
        resource: VENDOR_RESOURCE,
        allResources: ALL_RESOURCES,
        resolveVariable: () => undefined,
      })
    )
    expect(declared.map((d) => d.id)).toContain(`${nodeId}.usedDefaults`)
    expect(declared.map((d) => d.id)).toContain(`${nodeId}.defaultValues`)

    // Same reasoning as the configured-defaults scenario: the update
    // genuinely failed, so the full declared tree isn't resolvable — assert
    // write/label coverage plus the two variables this scenario exists to prove.
    assertLabelCoverage(declared, 'crud.update.default-strategy-empty')
    assertWrittenCovered(written, declared, 'crud.update.default-strategy-empty')
    expect(await ctx.resolveVariablePath(`${nodeId}.usedDefaults`)).toBe(false)
    expect(await ctx.resolveVariablePath(`${nodeId}.defaultValues`)).toBeNull()
  })
})
