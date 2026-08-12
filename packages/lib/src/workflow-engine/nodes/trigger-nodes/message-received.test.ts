// packages/lib/src/workflow-engine/nodes/trigger-nodes/message-received.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ExecutionContextManager } from '../../core/execution-context'
import type { WorkflowNode } from '../../core/types'
import { NodeRunningStatus, WorkflowNodeType } from '../../core/types'
import { MessageReceivedProcessor } from './message-received'

// Silence the logger. Partial mock: `@auxx/logger/run-log` imports sink-registration
// helpers from this barrel at module load, so a full replacement breaks collection.
vi.mock('@auxx/logger', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@auxx/logger')>()),
  createScopedLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

const getCachedEntityDefId =
  vi.fn<(orgId: string, entityType: string) => Promise<string | undefined>>()

// Partial mock: `execution-context` pulls `getCachedResourceFields` from this same
// barrel, so a full replacement breaks the file at collection.
vi.mock('../../../cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../cache')>()),
  getCachedEntityDefId: (orgId: string, entityType: string) =>
    getCachedEntityDefId(orgId, entityType),
}))

const TICKET_DEF_ID = 'def_ticket'

const triggerNode = (): WorkflowNode =>
  ({
    id: 'node-1',
    workflowId: 'workflow-1',
    nodeId: 'trigger-001',
    type: WorkflowNodeType.MESSAGE_RECEIVED,
    name: 'Message Received',
    data: { id: 'trigger-001', type: WorkflowNodeType.MESSAGE_RECEIVED, title: 'Message Received' },
  }) as unknown as WorkflowNode

/** A hydrated inbound message, optionally carrying a thread with a primary record. */
const message = (thread?: Record<string, unknown>) => ({
  id: 'msg-1',
  threadId: 'thread-1',
  subject: 'Where is my order?',
  textPlain: 'It never arrived.',
  isInbound: true,
  hasAttachments: false,
  receivedAt: '2026-08-11T10:00:00.000Z',
  from: { identifier: 'priya@example.com', name: 'Priya' },
  participants: [],
  thread,
})

describe('MessageReceivedProcessor', () => {
  let processor: MessageReceivedProcessor
  let contextManager: ExecutionContextManager

  const run = async (thread?: Record<string, unknown>) => {
    contextManager.initializeWithTrigger({
      type: WorkflowNodeType.MESSAGE_RECEIVED,
      data: { message: message(thread) },
      timestamp: new Date(),
    } as never)
    const node = triggerNode()
    const preprocessed = await processor.preprocessNode(node, contextManager)
    return processor.execute(node, contextManager, preprocessed)
  }

  beforeEach(() => {
    vi.clearAllMocks()
    getCachedEntityDefId.mockResolvedValue(TICKET_DEF_ID)
    processor = new MessageReceivedProcessor()
    contextManager = new ExecutionContextManager('workflow-1', 'exec-1', 'org-1', 'user-1')
  })

  describe('ticket output variable', () => {
    it('publishes the thread’s primary record when it is a ticket', async () => {
      await run({
        id: 'thread-1',
        primaryEntityInstanceId: 'inst_ticket_1',
        primaryEntityDefinitionId: TICKET_DEF_ID,
      })

      // The entity-object shape CRUD's `resourceId` reads an id out of —
      // `{{trigger-001.ticket}}` has to resolve to something `extractIdFromValue`
      // can turn into a bare EntityInstance id.
      await expect(contextManager.getVariable('trigger-001.ticket')).resolves.toEqual({
        id: 'inst_ticket_1',
        entityDefinitionId: TICKET_DEF_ID,
      })
      await expect(contextManager.getVariable('trigger-001.ticket.id')).resolves.toBe(
        'inst_ticket_1'
      )
    })

    it('publishes null when the thread has no primary record', async () => {
      await run({
        id: 'thread-1',
        primaryEntityInstanceId: null,
        primaryEntityDefinitionId: null,
      })

      await expect(contextManager.getVariable('trigger-001.ticket')).resolves.toBeNull()
      expect(getCachedEntityDefId).not.toHaveBeenCalled()
    })

    it('publishes null when the primary record is some other entity (a deal)', async () => {
      await run({
        id: 'thread-1',
        primaryEntityInstanceId: 'inst_deal_1',
        primaryEntityDefinitionId: 'def_deal',
      })

      await expect(contextManager.getVariable('trigger-001.ticket')).resolves.toBeNull()
    })

    it('publishes null when the org has no ticket definition', async () => {
      getCachedEntityDefId.mockResolvedValue(undefined)

      await run({
        id: 'thread-1',
        primaryEntityInstanceId: 'inst_ticket_1',
        primaryEntityDefinitionId: TICKET_DEF_ID,
      })

      await expect(contextManager.getVariable('trigger-001.ticket')).resolves.toBeNull()
    })

    it('publishes null when the message carries no hydrated thread', async () => {
      await run(undefined)

      await expect(contextManager.getVariable('trigger-001.ticket')).resolves.toBeNull()
    })
  })

  describe('existing message outputs', () => {
    it('still publishes the message and relation variables', async () => {
      const result = await run({
        id: 'thread-1',
        primaryEntityInstanceId: null,
        primaryEntityDefinitionId: null,
      })

      expect(result.status).toBe(NodeRunningStatus.Succeeded)
      await expect(contextManager.getVariable('trigger-001.message.id')).resolves.toBe('msg-1')
      await expect(contextManager.getVariable('trigger-001.thread')).resolves.toBe(
        'thread:thread-1'
      )
      await expect(contextManager.getVariable('trigger-001.message_ref')).resolves.toBe(
        'message:msg-1'
      )
    })
  })
})
