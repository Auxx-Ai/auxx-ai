// packages/lib/src/workflow-engine/nodes/action-nodes/__tests__/find-output-keying.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecutionContextManager } from '../../../core/execution-context'
import type { NodeExecutionResult, PreprocessedNodeData, WorkflowNode } from '../../../core/types'
import { NodeRunningStatus, WorkflowNodeType } from '../../../core/types'

/**
 * Pins the Find node's OUTPUT KEY — the half of the node's contract the variable
 * picker advertises and every downstream `{{…}}` path depends on.
 *
 * `findOne` used to key by `resource.label.toLowerCase()`, which the builder
 * never advertises (`generateFindNodeVariablesFromFields` bases the findOne
 * variable on `resourceMeta.id`). Two consequences, both pinned below:
 *
 * - the nine multi-word resource labels lowercase into keys containing spaces
 *   and slashes — `<node>.knowledge base`, `<node>.product / service` — which no
 *   variable path can address, and which drift from the `kb` / `catalog_item`
 *   the picker offers;
 * - on a custom entity the label write sat in the `else` branch of
 *   `isCustomResourceId(resourceType) && result`, so it only fired when NOTHING
 *   was found. A custom-entity findOne that succeeded had no expressible output
 *   path at all.
 *
 * The key is now `resource.id` in every lane: the `TableId` for a system table,
 * the `EntityDefinition` cuid for an entity-backed or custom resource — the same
 * value `setEntityVariables` and the resource triggers already use.
 */

const { executeResourceQuery } = vi.hoisted(() => ({
  executeResourceQuery: vi.fn(async (): Promise<any> => ({ id: 'row_1' })),
}))
const { entityFindMany } = vi.hoisted(() => ({
  entityFindMany: vi.fn(async (): Promise<any[]> => []),
}))

vi.mock('@auxx/database', async () => {
  const { createChainableDatabaseMock, createSchemaMock } = await import(
    '../../../../test/database-mock'
  )
  return {
    database: new Proxy({} as Record<string, unknown>, {
      get: (_target, prop) => {
        if (prop === 'then') return undefined
        if (prop === 'query') return { EntityInstance: { findMany: entityFindMany } }
        return createChainableDatabaseMock()
      },
    }),
    schema: createSchemaMock({ EntityInstance: {}, Thread: {} }),
  }
})
vi.mock('../../../../resources/resource-fetcher', () => ({ executeResourceQuery }))

/**
 * `resource.id` is what `findCachedResource` resolves to, whichever key the node
 * was configured with (id, `entityType` slug or `apiSlug`).
 *
 * The nine multi-word labels are the full set from `ModelTypeMeta`: every other
 * resource's label lowercases to something that happens to equal its id, which is
 * exactly why label keying looked correct for so long.
 */
const RESOURCES = [
  { id: 'thread', entityType: 'thread', apiSlug: 'threads', label: 'Thread', plural: 'Threads' },
  { id: 'kb', entityType: 'kb', apiSlug: 'kb', label: 'Knowledge Base', plural: 'Knowledge Bases' },
  {
    id: 'entitydefcuidpersonalinbox',
    entityType: 'personal_inbox',
    apiSlug: 'personal-inboxes',
    label: 'Personal Inbox',
    plural: 'Personal Inboxes',
  },
  {
    id: 'entitydefcuidvendorpart00',
    entityType: 'vendor_part',
    apiSlug: 'vendor-parts',
    label: 'Vendor Part',
    plural: 'Vendor Parts',
  },
  {
    id: 'entitydefcuidstockmovemen',
    entityType: 'stock_movement',
    apiSlug: 'stock-movements',
    label: 'Stock Movement',
    plural: 'Stock Movements',
  },
  {
    id: 'entitydefcuidworkorder000',
    entityType: 'work_order',
    apiSlug: 'work-orders',
    label: 'Work Order',
    plural: 'Work Orders',
  },
  {
    id: 'entitydefcuidservicereque',
    entityType: 'service_request',
    apiSlug: 'service-requests',
    label: 'Service Request',
    plural: 'Service Requests',
  },
  {
    id: 'entitydefcuidlineitem0000',
    entityType: 'line_item',
    apiSlug: 'line-items',
    label: 'Line Item',
    plural: 'Line Items',
  },
  {
    id: 'entitydefcuidcatalogitem0',
    entityType: 'catalog_item',
    apiSlug: 'catalog-items',
    label: 'Product / Service',
    plural: 'Products & Services',
  },
  {
    id: 'entitydefcuidcataloggroup',
    entityType: 'catalog_group',
    apiSlug: 'catalog-groups',
    label: 'Product Group',
    plural: 'Product Groups',
  },
  // A user-authored entity def: no `entityType`, addressed by apiSlug in templates.
  {
    id: 'entitydefcuidorders000000',
    apiSlug: 'orders',
    label: 'Order',
    plural: 'Orders',
  },
].map((r) => ({ ...r, fields: [], entityDefinitionId: r.id }))

/** Every multi-word label in `ModelTypeMeta` — the nine that diverged. */
const MULTI_WORD = RESOURCES.filter((r) => /[^a-z0-9]/.test(r.label.toLowerCase()))

vi.mock('../../../../cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../cache')>()),
  findCachedResource: vi.fn(async (_orgId: string, key: string) => {
    return RESOURCES.find((r) => r.id === key || r.entityType === key || r.apiSlug === key) ?? null
  }),
  getCachedResource: vi.fn(async (_orgId: string, key: string) => {
    return RESOURCES.find((r) => r.id === key) ?? null
  }),
  getCachedResourceFields: vi.fn(async () => []),
}))
vi.mock('../../../../permissions/visibility/automation-visibility', () => ({
  getAutomationVisibility: vi.fn(async () => ({
    kind: 'automation' as const,
    personalInboxIds: {},
  })),
}))

const { FindProcessor } = await import('../find')

class TestableFindProcessor extends FindProcessor {
  runNode(
    node: WorkflowNode,
    contextManager: ExecutionContextManager,
    preprocessedData?: PreprocessedNodeData
  ): Promise<Partial<NodeExecutionResult>> {
    return this.executeNode(node, contextManager, preprocessedData)
  }
}

const findNode = (resourceType: string): WorkflowNode =>
  ({
    id: 'find_1',
    workflowId: 'workflow_1',
    nodeId: 'find_1',
    name: 'Find',
    type: WorkflowNodeType.FIND,
    data: { id: 'find_1', type: WorkflowNodeType.FIND, title: 'Find', resourceType },
    metadata: { position: { x: 0, y: 0 } },
  }) as unknown as WorkflowNode

function makeContextManager() {
  const written: Record<string, unknown> = {}
  const contextManager = {
    getContext: () => ({ organizationId: 'org_1', userId: 'user_1' }),
    getVariable: vi.fn(),
    setVariable: vi.fn((key: string, value: unknown) => {
      written[key] = value
    }),
    setNodeVariable: vi.fn((nodeId: string, path: string, value: unknown) => {
      written[`${nodeId}.${path}`] = value
    }),
    cacheRecordBase: vi.fn(),
    log: vi.fn(),
  }
  return { contextManager: contextManager as unknown as ExecutionContextManager, written }
}

async function run(resourceType: string, findMode: 'findOne' | 'findMany' = 'findOne') {
  const { contextManager, written } = makeContextManager()
  const result = await new TestableFindProcessor().runNode(findNode(resourceType), contextManager, {
    inputs: {
      resourceType,
      findMode,
      conditions: [],
      conditionGroups: [],
      orderBy: undefined,
      limit: undefined,
    },
    metadata: {},
  } as unknown as PreprocessedNodeData)
  return { result, written }
}

/** The node's own top-level output keys, minus the two fixed ones. */
const resultKeys = (written: Record<string, unknown>) =>
  Object.keys(written).filter((k) => !/^find_1\.(count|query_info)$/.test(k))

beforeEach(() => {
  executeResourceQuery.mockClear()
  executeResourceQuery.mockResolvedValue({ id: 'row_1' })
  entityFindMany.mockClear()
  entityFindMany.mockResolvedValue([{ id: 'inst_1', createdAt: null, updatedAt: null }])
})

describe('findOne keys the result by the resource id', () => {
  it('uses the TableId for a system resource, not the label', async () => {
    const { result, written } = await run('kb')

    expect(result.status).toBe(NodeRunningStatus.Succeeded)
    expect(written['find_1.kb']).toEqual({ id: 'row_1' })
    // The old key. `{{find_1.knowledge base}}` is not an addressable path.
    expect(written).not.toHaveProperty('find_1.knowledge base')
  })

  it('uses the EntityDefinition cuid for an entity-backed resource', async () => {
    const { result, written } = await run('work_order')

    expect(result.status).toBe(NodeRunningStatus.Succeeded)
    // `setEntityVariables` writes the reference plus its standard fields.
    expect(written).toHaveProperty('find_1.entitydefcuidworkorder000')
    expect(written['find_1.entitydefcuidworkorder000.id']).toBe('inst_1')
    expect(written).not.toHaveProperty('find_1.work order')
  })

  it('resolves the same key whether the node stores the id, the slug or the apiSlug', async () => {
    const bySlug = await run('work_order')
    const byId = await run('entitydefcuidworkorder000')
    const byApiSlug = await run('work-orders')

    expect(resultKeys(byId.written)).toEqual(resultKeys(bySlug.written))
    expect(resultKeys(byApiSlug.written)).toEqual(resultKeys(bySlug.written))
  })

  it('writes the miss, so a "not found" is expressible', async () => {
    entityFindMany.mockResolvedValue([])
    const { written } = await run('orders')

    // Before, the null case fell into the label branch and the success case into
    // the cuid branch — the two outcomes of ONE node landed on different keys.
    expect(written).toHaveProperty('find_1.entitydefcuidorders000000')
    expect(written['find_1.entitydefcuidorders000000']).toBeNull()
  })

  it.each(
    MULTI_WORD.map((r) => [r.label, r.entityType ?? r.apiSlug, r.id] as const)
  )('round-trips `%s` on the id key (%s → %s)', async (label, configuredAs, expectedId) => {
    const { result, written } = await run(configuredAs)

    expect(result.status).toBe(NodeRunningStatus.Succeeded)
    expect(written).toHaveProperty(`find_1.${expectedId}`)
    expect(written).not.toHaveProperty(`find_1.${label.toLowerCase()}`)
    // No output key may contain a character a `{{…}}` path cannot carry.
    for (const key of resultKeys(written)) {
      expect(key).toMatch(/^[\w.[\]*-]+$/)
    }
  })
})

describe('findMany dual-writes the canonical id key and a legacy plural alias', () => {
  /**
   * Flips the old "findMany keeps keying by the plural name" pin — see
   * `plans/kopilot/workflow/10-variable-resolution-deep-dive.md` §10/§10b step
   * 5. The plural is a USER-EDITABLE string (entity settings), so keying
   * findMany's array by it silently broke every `{{node.<plural>…}}` ref on
   * rename. The array is now written under the CANONICAL `resource.id` key
   * (what `generateFindNodeVariablesFromFields` declares going forward) AND
   * the legacy `resource.plural.toLowerCase()` key — same array reference —
   * so refs stored before the plural→id DataMigration keep resolving. Retire
   * the legacy assertions here together with the engine's legacy write once
   * that migration has run everywhere.
   */
  it('keys a system-resource array by the id, plus a legacy plural-keyed alias (same array)', async () => {
    executeResourceQuery.mockResolvedValue([{ id: 'row_1' }, { id: 'row_2' }])
    const { written } = await run('kb', 'findMany')

    expect(written['find_1.kb']).toHaveLength(2)
    // Legacy alias, multi-word plural — the space is still legal here (it's
    // the pre-migration back-compat key, never the advertised one).
    expect(written['find_1.knowledge bases']).toHaveLength(2)
    // Dual-write, not a copy: same array reference on both keys.
    expect(written['find_1.kb']).toBe(written['find_1.knowledge bases'])
  })

  it('keys a custom-entity array by the id, plus a legacy plural-keyed alias', async () => {
    const { written } = await run('orders', 'findMany')

    expect(written['find_1.entitydefcuidorders000000']).toHaveLength(1)
    expect(written['find_1.orders']).toHaveLength(1)
    expect(written['find_1.entitydefcuidorders000000']).toBe(written['find_1.orders'])
  })
})
