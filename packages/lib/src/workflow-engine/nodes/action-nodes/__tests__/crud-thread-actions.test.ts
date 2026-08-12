// packages/lib/src/workflow-engine/nodes/action-nodes/__tests__/crud-thread-actions.test.ts

import { RelationUpdateMode } from '@auxx/types/custom-field'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NodeData, WorkflowNode } from '../../../core/types'
import { BaseType, WorkflowNodeType } from '../../../core/types'
import { CrudNodeProcessor } from '../crud'

/**
 * Every action-result variable the builder advertises for a `thread` CRUD node.
 * Mirrors `generateThreadActionVariables` in
 * `apps/web/src/components/workflow/nodes/core/crud/output-variables.ts` — if the
 * two lists drift, the picker offers paths the engine never writes.
 */
const ADVERTISED_THREAD_VARIABLES = [
  'id',
  'success',
  'statusUpdated',
  'subjectUpdated',
  'assigneeUpdated',
  'readStatusUpdated',
  'tagsUpdated',
  'inboxUpdated',
  'primaryEntityUpdated',
  'newStatus',
  'newSubject',
  'newAssigneeId',
  'newReadStatus',
  'newInboxId',
  'newPrimaryEntityId',
  'actionCount',
  'actionsPerformed',
  'errors',
] as const

const crudNode = (nodeId: string, name: string, data: Partial<NodeData>): WorkflowNode => ({
  id: nodeId,
  workflowId: 'workflow_1',
  nodeId,
  name,
  type: WorkflowNodeType.CRUD,
  data: { id: nodeId, type: WorkflowNodeType.CRUD, title: name, ...data },
  metadata: { position: { x: 0, y: 0 } },
})

/**
 * `preprocessNode` reads the resource's field list from the org cache to decide
 * which keys are relations. These entries mirror `THREAD_FIELDS`
 * (`resources/registry/resources/thread-fields.ts`) for the three that matter:
 * `assignee` is ACTOR (NOT renamed to its `assigneeId` dbColumn), `inbox` is a
 * single RELATION (renamed to `inboxId`) and `tags` is a `has_many` RELATION
 * with no dbColumn (wrapped in the `{values, updateMode}` envelope).
 */
vi.mock('../../../../cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../cache')>()),
  findCachedResource: vi.fn(async (_organizationId: string, resourceType: string) =>
    resourceType === 'thread'
      ? {
          id: 'thread',
          entityDefinitionId: 'thread_def',
          fields: [
            { id: 'thread:subject', key: 'subject', type: BaseType.STRING, dbColumn: 'subject' },
            { id: 'thread:status', key: 'status', type: BaseType.ENUM, dbColumn: 'status' },
            { id: 'thread:readStatus', key: 'readStatus', type: BaseType.ENUM },
            {
              id: 'thread:assignee',
              key: 'assignee',
              type: BaseType.ACTOR,
              dbColumn: 'assigneeId',
            },
            {
              id: 'thread:inbox',
              key: 'inbox',
              type: BaseType.RELATION,
              dbColumn: 'inboxId',
              relationship: { relationshipType: 'belongs_to' },
            },
            {
              id: 'thread:tags',
              key: 'tags',
              type: BaseType.RELATION,
              relationship: { relationshipType: 'has_many' },
            },
            {
              id: 'thread:ticket',
              key: 'ticket',
              type: BaseType.RELATION,
              dbColumn: 'primaryEntityInstanceId',
              relationship: { relationshipType: 'belongs_to' },
            },
          ],
        }
      : null
  ),
  requireCachedEntityDefId: vi.fn(async (_organizationId: string, entityType: string) =>
    entityType === 'tag' ? 'tag_def' : 'thread_def'
  ),
}))

const threadUpdate = vi.fn(async () => ({}))
const tagThreadsBulk = vi.fn(async () => ({ created: 1, skipped: 0, errors: [] }))
const setReadStatus = vi.fn(async () => undefined)

vi.mock('../../../../threads/thread-mutation.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../threads/thread-mutation.service')>()),
  ThreadMutationService: class {
    update = threadUpdate
    tagThreadsBulk = tagThreadsBulk
  },
}))

vi.mock('../../../../threads/unread-service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../threads/unread-service')>()),
  UnreadService: class {
    setReadStatus = setReadStatus
  },
}))

const canLinkThread = vi.fn(async () => true)
const linkEntityToThread = vi.fn(async () => undefined)
const clearPrimaryEntity = vi.fn(async () => undefined)

vi.mock('../../../../threads/links.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../threads/links.service')>()),
  canLinkThread: (...args: unknown[]) => canLinkThread(...(args as [])),
  linkEntityToThread: (...args: unknown[]) => linkEntityToThread(...(args as [])),
  clearPrimaryEntity: (...args: unknown[]) => clearPrimaryEntity(...(args as [])),
}))

vi.mock('../../../../permissions/visibility/automation-visibility', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../../../permissions/visibility/automation-visibility')
  >()),
  getAutomationVisibility: vi.fn(async () => ({}) as any),
}))

describe('CrudNodeProcessor - thread action contract', () => {
  let processor: CrudNodeProcessor
  let contextManager: any
  let nodeVariables: Record<string, unknown>

  /** Preprocess then execute a thread CRUD node, returning the node variables written. */
  const runThreadNode = async (data: Record<string, unknown>, extra: Partial<NodeData> = {}) => {
    const node = crudNode('crud_1', 'Update Thread', {
      resourceType: 'thread',
      mode: 'update',
      resourceId: 'thread_123',
      data,
      ...extra,
    })
    const preprocessed = await processor.preprocessNode(node, contextManager)
    const result = await (processor as any).executeNode(node, contextManager, preprocessed)
    return { preprocessed, result }
  }

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
      setNodeVariable: vi.fn((_nodeId: string, key: string, value: unknown) => {
        nodeVariables[key] = value
      }),
      log: vi.fn(),
      getContext: vi.fn(() => ({ organizationId: 'org_test_123', userId: 'user_test_123' })),
    }
  })

  describe('advertised output variables', () => {
    it('writes every advertised action variable as a node variable', async () => {
      await runThreadNode({
        status: 'ARCHIVED',
        subject: 'Renamed',
        assignee: 'user_1',
        inbox: 'inbox_1',
        readStatus: 'READ',
        tags: ['tag_def:tag_1'],
        ticket: 'ticket_def:ticket_1',
      })

      for (const key of ADVERTISED_THREAD_VARIABLES) {
        expect(nodeVariables, `missing node variable "${key}"`).toHaveProperty(key)
      }

      expect(nodeVariables.id).toBe('thread_123')
      expect(nodeVariables.success).toBe(true)
      expect(nodeVariables.statusUpdated).toBe(true)
      expect(nodeVariables.newStatus).toBe('ARCHIVED')
      expect(nodeVariables.subjectUpdated).toBe(true)
      expect(nodeVariables.newSubject).toBe('Renamed')
      expect(nodeVariables.assigneeUpdated).toBe(true)
      expect(nodeVariables.newAssigneeId).toBe('user:user_1')
      expect(nodeVariables.inboxUpdated).toBe(true)
      expect(nodeVariables.newInboxId).toBe('inbox:inbox_1')
      expect(nodeVariables.readStatusUpdated).toBe(true)
      expect(nodeVariables.newReadStatus).toBe('READ')
      expect(nodeVariables.tagsUpdated).toBe(true)
      expect(nodeVariables.primaryEntityUpdated).toBe(true)
      expect(nodeVariables.newPrimaryEntityId).toBe('ticket_1')
      expect(nodeVariables.actionCount).toBe(7)
      expect(nodeVariables.actionsPerformed).toHaveLength(7)
      expect(nodeVariables.errors).toEqual([])
    })

    it('writes skipped actions as false/null instead of leaving them unresolvable', async () => {
      await runThreadNode({ status: 'ARCHIVED' })

      for (const key of ADVERTISED_THREAD_VARIABLES) {
        expect(nodeVariables, `missing node variable "${key}"`).toHaveProperty(key)
      }

      expect(nodeVariables.statusUpdated).toBe(true)
      expect(nodeVariables.subjectUpdated).toBe(false)
      expect(nodeVariables.assigneeUpdated).toBe(false)
      expect(nodeVariables.tagsUpdated).toBe(false)
      expect(nodeVariables.readStatusUpdated).toBe(false)
      expect(nodeVariables.inboxUpdated).toBe(false)
      expect(nodeVariables.primaryEntityUpdated).toBe(false)
      expect(nodeVariables.newSubject).toBeNull()
      expect(nodeVariables.newAssigneeId).toBeNull()
      expect(nodeVariables.newInboxId).toBeNull()
      expect(nodeVariables.newReadStatus).toBeNull()
      expect(nodeVariables.newPrimaryEntityId).toBeNull()
      expect(nodeVariables.actionCount).toBe(1)
    })

    it('still exposes the thread resource reference', async () => {
      await runThreadNode({ status: 'ARCHIVED' })

      expect(nodeVariables.thread).toMatchObject({
        __resourceRef: true,
        resourceType: 'thread',
        resourceId: 'thread_123',
      })
    })

    it('reports a partial failure through success/errors rather than throwing', async () => {
      threadUpdate.mockRejectedValueOnce(new Error('nope'))

      await runThreadNode({ status: 'ARCHIVED', readStatus: 'READ' })

      expect(nodeVariables.success).toBe(false)
      expect(nodeVariables.errors).toEqual(['Thread update failed: nope'])
      expect(nodeVariables.statusUpdated).toBe(false)
      expect(nodeVariables.readStatusUpdated).toBe(true)
    })
  })

  describe('assignee key alignment', () => {
    it('keeps the panel key `assignee` through preprocessing (ACTOR is not renamed)', async () => {
      const { preprocessed } = await runThreadNode({ assignee: 'user_1' })

      expect(preprocessed.inputs.data).toHaveProperty('assignee', 'user_1')
      expect(preprocessed.inputs.data).not.toHaveProperty('assigneeId')
    })

    it('reads `data.assignee` and prefixes a bare user id into an ActorId', async () => {
      await runThreadNode({ assignee: 'user_1' })

      expect(threadUpdate).toHaveBeenCalledWith('thread:thread_123', { assigneeId: 'user:user_1' })
    })

    it('passes an already-qualified ActorId through untouched', async () => {
      await runThreadNode({ assignee: 'agent:agent_9' })

      expect(threadUpdate).toHaveBeenCalledWith('thread:thread_123', {
        assigneeId: 'agent:agent_9',
      })
    })

    it('unassigns on an explicit null', async () => {
      await runThreadNode({ assignee: null })

      expect(threadUpdate).toHaveBeenCalledWith('thread:thread_123', { assigneeId: null })
      expect(nodeVariables.assigneeUpdated).toBe(true)
      expect(nodeVariables.newAssigneeId).toBeNull()
    })

    it('extracts the id from a resolved entity object', async () => {
      await runThreadNode({ assignee: { id: 'user_7', name: 'Ada' } })

      expect(threadUpdate).toHaveBeenCalledWith('thread:thread_123', { assigneeId: 'user:user_7' })
    })

    it('ignores the old `assigneeId` key so the two sides cannot silently re-drift', async () => {
      await runThreadNode({ assigneeId: 'user_1' })

      expect(threadUpdate).not.toHaveBeenCalled()
    })
  })

  describe('tags {values, updateMode} envelope', () => {
    it('preprocessing wraps a multi-relation tag write in the envelope', async () => {
      const { preprocessed } = await runThreadNode(
        { tags: ['tag_def:tag_1', 'tag_def:tag_2'] },
        { fieldUpdateModes: { tags: RelationUpdateMode.ADD } }
      )

      expect(preprocessed.inputs.data.tags).toEqual({
        values: ['tag_def:tag_1', 'tag_def:tag_2'],
        updateMode: 'add',
      })
    })

    it.each([
      [RelationUpdateMode.ADD, 'add'],
      [RelationUpdateMode.REMOVE, 'remove'],
      [RelationUpdateMode.REPLACE, 'set'],
    ])('maps updateMode %s to the %s tag operation', async (updateMode, operation) => {
      await runThreadNode({ tags: ['tag_def:tag_1'] }, { fieldUpdateModes: { tags: updateMode } })

      expect(tagThreadsBulk).toHaveBeenCalledWith(
        ['thread_def:thread_123'],
        ['tag_def:tag_1'],
        operation
      )
      expect(nodeVariables.tagsUpdated).toBe(true)
      expect(nodeVariables.actionsPerformed).toEqual([`Tags ${operation}: 1 tag(s)`])
    })

    it('defaults to replace/set when no update mode is configured', async () => {
      await runThreadNode({ tags: ['tag_def:tag_1'] })

      expect(tagThreadsBulk).toHaveBeenCalledWith(
        ['thread_def:thread_123'],
        ['tag_def:tag_1'],
        'set'
      )
    })

    it('resolves a dynamic update mode variable to a real operation', async () => {
      contextManager.resolveVariablePath.mockImplementation(async (path: string) =>
        path === 'trigger_1.mode' ? 'remove' : undefined
      )

      await runThreadNode(
        { tags: ['tag_def:tag_1'] },
        {
          fieldUpdateModes: { tags: RelationUpdateMode.DYNAMIC },
          fieldUpdateModeVars: { tags: '{{trigger_1.mode}}' },
        }
      )

      expect(tagThreadsBulk).toHaveBeenCalledWith(
        ['thread_def:thread_123'],
        ['tag_def:tag_1'],
        'remove'
      )
    })

    it('normalizes bare tag ids onto the tag entity definition', async () => {
      await runThreadNode({ tags: ['tag_1', 'tag_2'] }, { fieldUpdateModes: { tags: 'add' } })

      expect(tagThreadsBulk).toHaveBeenCalledWith(
        ['thread_def:thread_123'],
        ['tag_def:tag_1', 'tag_def:tag_2'],
        'add'
      )
    })

    it('accepts ResourceReferences from an upstream find node', async () => {
      await runThreadNode(
        {
          tags: [
            { __resourceRef: true, resourceType: 'tag_def', resourceId: 'tag_1' },
            { __resourceRef: true, resourceType: 'tag_def', resourceId: 'tag_2' },
          ],
        },
        { fieldUpdateModes: { tags: 'add' } }
      )

      expect(tagThreadsBulk).toHaveBeenCalledWith(
        ['thread_def:thread_123'],
        ['tag_def:tag_1', 'tag_def:tag_2'],
        'add'
      )
    })

    it('skips the tag action entirely when the envelope carries no values', async () => {
      await runThreadNode({ tags: [] }, { fieldUpdateModes: { tags: 'add' } })

      expect(tagThreadsBulk).not.toHaveBeenCalled()
      expect(nodeVariables.tagsUpdated).toBe(false)
    })
  })

  describe('primary record link (thread.ticket)', () => {
    it('preprocessing renames the ticket field to its primaryEntityInstanceId column', async () => {
      const { preprocessed } = await runThreadNode({ ticket: 'ticket_def:ticket_1' })

      expect(preprocessed.inputs.data).toHaveProperty(
        'primaryEntityInstanceId',
        'ticket_def:ticket_1'
      )
      expect(preprocessed.inputs.data).not.toHaveProperty('ticket')
    })

    it('links through linkEntityToThread so both primary columns are written', async () => {
      await runThreadNode({ ticket: 'ticket_def:ticket_1' })

      // The service reads entityDefinitionId off the EntityInstance and writes
      // primaryEntityInstanceId + primaryEntityDefinitionId in one transaction —
      // the executor must hand it the bare instance id, not the RecordId.
      expect(linkEntityToThread).toHaveBeenCalledWith({
        threadId: 'thread_123',
        entityInstanceId: 'ticket_1',
        role: 'primary',
        organizationId: 'org_test_123',
        actorId: 'user_test_123',
      })
      expect(nodeVariables.primaryEntityUpdated).toBe(true)
      expect(nodeVariables.newPrimaryEntityId).toBe('ticket_1')
      expect(nodeVariables.actionsPerformed).toEqual(['Linked record ticket_1'])
    })

    it('accepts a bare instance id', async () => {
      await runThreadNode({ ticket: 'ticket_1' })

      expect(linkEntityToThread).toHaveBeenCalledWith(
        expect.objectContaining({ entityInstanceId: 'ticket_1' })
      )
    })

    it('accepts a ResourceReference from an upstream find node', async () => {
      await runThreadNode({
        ticket: { __resourceRef: true, resourceType: 'ticket', resourceId: 'ticket_9' },
      })

      expect(linkEntityToThread).toHaveBeenCalledWith(
        expect.objectContaining({ entityInstanceId: 'ticket_9' })
      )
    })

    it('clears the primary link (demoting it to a secondary) on an empty value', async () => {
      await runThreadNode({ ticket: '' })

      expect(linkEntityToThread).not.toHaveBeenCalled()
      expect(clearPrimaryEntity).toHaveBeenCalledWith({
        threadId: 'thread_123',
        organizationId: 'org_test_123',
        actorId: 'user_test_123',
      })
      expect(nodeVariables.primaryEntityUpdated).toBe(true)
      expect(nodeVariables.newPrimaryEntityId).toBeNull()
    })

    it('refuses the link when the §7 lens gate says the thread is not visible', async () => {
      canLinkThread.mockResolvedValueOnce(false)

      // Sole action, so its failure fails the node (nothing was performed).
      const { result } = await runThreadNode({ ticket: 'ticket_def:ticket_1' })

      expect(linkEntityToThread).not.toHaveBeenCalled()
      expect(result.status).toBe('failed')
      expect(result.error).toContain('Record link failed: thread not found')
      expect(nodeVariables.success).toBe(false)
    })

    it('reports a refused link as a partial failure alongside a successful action', async () => {
      canLinkThread.mockResolvedValueOnce(false)

      await runThreadNode({ status: 'ARCHIVED', ticket: 'ticket_def:ticket_1' })

      expect(linkEntityToThread).not.toHaveBeenCalled()
      expect(nodeVariables.statusUpdated).toBe(true)
      expect(nodeVariables.primaryEntityUpdated).toBe(false)
      expect(nodeVariables.newPrimaryEntityId).toBeNull()
      expect(nodeVariables.success).toBe(false)
      expect(nodeVariables.errors).toEqual(['Record link failed: thread not found'])
    })

    it('does not touch the link when the field is absent', async () => {
      await runThreadNode({ status: 'ARCHIVED' })

      expect(canLinkThread).not.toHaveBeenCalled()
      expect(linkEntityToThread).not.toHaveBeenCalled()
      expect(clearPrimaryEntity).not.toHaveBeenCalled()
    })
  })

  describe('inbox move', () => {
    it('unassigns rather than writing the literal id "null" on a cleared picker', async () => {
      await runThreadNode({ inbox: '' })

      expect(threadUpdate).toHaveBeenCalledWith('thread:thread_123', { inboxId: null })
    })

    it('qualifies a bare inbox id and passes a RecordId through', async () => {
      await runThreadNode({ inbox: 'inbox_1' })
      expect(threadUpdate).toHaveBeenCalledWith('thread:thread_123', { inboxId: 'inbox:inbox_1' })

      threadUpdate.mockClear()
      await runThreadNode({ inbox: 'personal_inbox:inbox_2' })
      expect(threadUpdate).toHaveBeenCalledWith('thread:thread_123', {
        inboxId: 'personal_inbox:inbox_2',
      })
    })
  })
})
