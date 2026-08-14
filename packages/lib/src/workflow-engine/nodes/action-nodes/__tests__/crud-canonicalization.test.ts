// packages/lib/src/workflow-engine/nodes/action-nodes/__tests__/crud-canonicalization.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NodeData, WorkflowNode } from '../../../core/types'
import { WorkflowNodeType } from '../../../core/types'
import { CrudNodeProcessor } from '../crud'

/**
 * Mirrors `find-output-keying.test.ts`'s mock scaffolding: `findCachedResource`
 * matches by id OR entityType, exactly like the real cache helper, so a node
 * configured with either alias resolves to the SAME resource object.
 *
 * `WORK_ORDER_DEF_ID` stands in for the resolved EntityDefinition cuid —
 * deliberately unrelated in shape to the entityType slug `work_order`, so a
 * key collision between the two runs can only happen if canonicalization
 * actually ran.
 */
const WORK_ORDER_DEF_ID = 'work_order_def_cuid_00000000'

vi.mock('../../../../cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../cache')>()),
  findCachedResource: vi.fn(async (_organizationId: string, key: string) =>
    key === 'work_order' || key === WORK_ORDER_DEF_ID
      ? { id: WORK_ORDER_DEF_ID, entityType: 'work_order', fields: [] }
      : null
  ),
}))

/**
 * `createWithValues` deliberately omits `entityDefinitionId` on the returned
 * `entityInstance`, forcing `executeNode`'s
 * `result.entityInstance?.entityDefinitionId ?? <resourceType>` fallback to
 * fire. Pre-Fix-1 that fallback received whatever alias the node was
 * configured with — a raw entityType slug (`work_order`) fails
 * `setEntityVariables`'s own `isCustomResourceId` gate and throws. Post-fix
 * the fallback receives the canonicalized `resource.id` regardless of the
 * configured alias, so both runs below succeed and key identically.
 */
const createWithValues = vi.fn(async () => ({
  entityInstance: { id: 'inst_1', createdAt: null, updatedAt: null },
  id: 'inst_1',
}))

vi.mock('../../../../resources/crud', () => ({
  UnifiedCrudHandler: class {
    createWithValues = createWithValues
  },
}))

const crudNode = (nodeId: string, resourceType: string): WorkflowNode => ({
  id: nodeId,
  workflowId: 'workflow_1',
  nodeId,
  name: 'Create Work Order',
  type: WorkflowNodeType.CRUD,
  data: {
    id: nodeId,
    type: WorkflowNodeType.CRUD,
    title: 'Create Work Order',
    resourceType,
    mode: 'create',
    data: {},
  } as unknown as Partial<NodeData>,
  metadata: { position: { x: 0, y: 0 } },
})

describe('CrudNodeProcessor - resource canonicalization', () => {
  let contextManager: any
  let nodeVariables: Record<string, unknown>

  beforeEach(() => {
    vi.clearAllMocks()
    createWithValues.mockResolvedValue({
      entityInstance: { id: 'inst_1', createdAt: null, updatedAt: null },
      id: 'inst_1',
    })
    nodeVariables = {}

    contextManager = {
      getVariable: vi.fn(async (path: string) => {
        if (path === 'sys.organizationId') return 'org_test_123'
        if (path === 'sys.userId') return 'user_test_123'
        return undefined
      }),
      resolveVariablePath: vi.fn(async () => undefined),
      interpolateVariables: vi.fn(async (text: string) => text),
      // `setEntityVariables` calls `setVariable` with an already nodeId-prefixed
      // key (`${nodeId}.${resourceType}...`); strip the known `crud_1.` prefix
      // so both writers land in the same flat, bare-path key space as
      // `setNodeVariable` below — matching how a real flat variable store
      // resolves `{{crud_1.<path>}}` the same way regardless of which call
      // wrote it.
      setVariable: vi.fn((key: string, value: unknown) => {
        nodeVariables[key.replace(/^crud_1\./, '')] = value
      }),
      setNodeVariable: vi.fn((nodeId: string, key: string, value: unknown) => {
        nodeVariables[key] = value
      }),
      log: vi.fn(),
      getContext: vi.fn(() => ({ organizationId: 'org_test_123', userId: 'user_test_123' })),
    }
  })

  const run = async (resourceType: string) => {
    const processor = new CrudNodeProcessor()
    const node = crudNode('crud_1', resourceType)
    const preprocessed = await processor.preprocessNode(node, contextManager)
    const result = await (processor as any).executeNode(node, contextManager, preprocessed)
    return { result, written: { ...nodeVariables } }
  }

  it('a crud configured with the entityType slug and one with the resolved resource id write identical variable keys', async () => {
    const bySlug = await run('work_order')
    nodeVariables = {}
    const byId = await run(WORK_ORDER_DEF_ID)

    expect(bySlug.result.status).toBe('succeeded')
    expect(byId.result.status).toBe('succeeded')

    expect(Object.keys(bySlug.written).sort()).toEqual(Object.keys(byId.written).sort())
    expect(bySlug.written).toEqual(byId.written)
  })

  it('keys the record reference and entity tree under the canonical id, never the configured alias', async () => {
    const { written } = await run('work_order')

    expect(written.record).toMatchObject({ resourceType: WORK_ORDER_DEF_ID, resourceId: 'inst_1' })
    expect(written[WORK_ORDER_DEF_ID]).toMatchObject({
      resourceType: WORK_ORDER_DEF_ID,
      resourceId: 'inst_1',
    })
    expect(written.work_order).toBeUndefined()
  })

  it('does not throw when entityInstance omits entityDefinitionId (the latent-guard regression)', async () => {
    const { result } = await run('work_order')

    expect(result.status).toBe('succeeded')
    expect(result.error).toBeUndefined()
  })
})
