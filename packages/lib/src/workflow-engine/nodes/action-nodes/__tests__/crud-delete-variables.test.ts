// packages/lib/src/workflow-engine/nodes/action-nodes/__tests__/crud-delete-variables.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NodeData, WorkflowNode } from '../../../core/types'
import { WorkflowNodeType } from '../../../core/types'
import { CrudNodeProcessor } from '../crud'

/**
 * `generateCrudNodeVariablesFromFields` (resources/variable-generators.ts)
 * declares `deleted` (BOOLEAN) + `id` (STRING) for delete mode, but
 * `executeNode`'s `if (result.id && mode !== 'delete')` gate used to keep
 * delete from ever writing them — the operation returns exactly
 * `{ deleted: true, id: resourceId }` and nothing picked it up. This suite
 * pins the fix.
 *
 * `ticket_def_cuid_0000000000` stands in for the resolved EntityDefinition
 * cuid `findCachedResource` would return for the entityType slug `ticket` —
 * deliberately different from the configured `resourceType` so a passing
 * `resourceType` assertion also proves canonicalization ran (Fix 1).
 */
const TICKET_ENTITY_DEF_ID = 'ticket_def_cuid_0000000000'

const crudNode = (nodeId: string, name: string, data: Partial<NodeData>): WorkflowNode => ({
  id: nodeId,
  workflowId: 'workflow_1',
  nodeId,
  name,
  type: WorkflowNodeType.CRUD,
  data: { id: nodeId, type: WorkflowNodeType.CRUD, title: name, ...data },
  metadata: { position: { x: 0, y: 0 } },
})

vi.mock('../../../../cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../cache')>()),
  findCachedResource: vi.fn(async (_organizationId: string, resourceType: string) =>
    resourceType === 'ticket' || resourceType === TICKET_ENTITY_DEF_ID
      ? { id: TICKET_ENTITY_DEF_ID, entityDefinitionId: TICKET_ENTITY_DEF_ID, fields: [] }
      : null
  ),
}))

const archive = vi.fn(async () => undefined)

vi.mock('../../../../resources/crud', () => ({
  UnifiedCrudHandler: class {
    archive = archive
  },
}))

describe('CrudNodeProcessor - delete writes its declared variables', () => {
  let processor: CrudNodeProcessor
  let contextManager: any
  let nodeVariables: Record<string, unknown>

  beforeEach(() => {
    vi.clearAllMocks()
    processor = new CrudNodeProcessor()
    nodeVariables = {}

    contextManager = {
      getVariable: vi.fn(async (path: string) => {
        if (path === 'sys.organizationId') return 'org_test_123'
        if (path === 'sys.userId') return 'user_test_123'
        return undefined
      }),
      resolveVariablePath: vi.fn(async () => undefined),
      interpolateVariables: vi.fn(async (text: string) => text),
      // `setEntityVariables` (unused in delete mode, but kept consistent with
      // the canonicalization test) writes via an already nodeId-prefixed
      // `setVariable` key — strip it so both writers share one bare-path key
      // space, same as `setNodeVariable` below.
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

  const runDelete = async () => {
    const node = crudNode('crud_1', 'Delete Ticket', {
      resourceType: 'ticket',
      mode: 'delete',
      resourceId: 'ticket_123',
      data: {},
    })
    const preprocessed = await processor.preprocessNode(node, contextManager)
    return (processor as any).executeNode(node, contextManager, preprocessed)
  }

  it('writes `deleted` and `id`', async () => {
    const result = await runDelete()

    expect(result.status).toBe('succeeded')
    expect(archive).toHaveBeenCalledOnce()
    expect(nodeVariables.deleted).toBe(true)
    expect(nodeVariables.id).toBe('ticket_123')
  })

  it('still writes the four unconditional run-metadata variables', async () => {
    await runDelete()

    expect(nodeVariables.operation).toBe('delete')
    expect(nodeVariables.success).toBe(true)
    expect(nodeVariables.error).toBeNull()
    // Canonicalized: the configured alias was the entityType slug `ticket`,
    // not the resolved EntityDefinition id.
    expect(nodeVariables.resourceType).toBe(TICKET_ENTITY_DEF_ID)
  })

  it('does not enter the create/update resource-reference branch', async () => {
    await runDelete()

    // `record` and the `setEntityVariables` tree are create/update-only —
    // delete's own `if (mode === 'delete')` block is a separate arm, not a
    // fallthrough of the `result.id && mode !== 'delete'` branch.
    expect(nodeVariables.record).toBeUndefined()
    expect(nodeVariables[TICKET_ENTITY_DEF_ID]).toBeUndefined()
  })
})
