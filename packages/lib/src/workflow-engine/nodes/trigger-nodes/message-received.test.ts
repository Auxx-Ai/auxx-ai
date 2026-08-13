// packages/lib/src/workflow-engine/nodes/trigger-nodes/message-received.test.ts

import { ParticipantRole } from '@auxx/database/enums'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Condition, ConditionGroup } from '../../../conditions/types'
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

const triggerNode = (dataOverrides: Record<string, unknown> = {}): WorkflowNode =>
  ({
    id: 'node-1',
    workflowId: 'workflow-1',
    nodeId: 'trigger-001',
    type: WorkflowNodeType.MESSAGE_RECEIVED,
    name: 'Message Received',
    data: {
      id: 'trigger-001',
      type: WorkflowNodeType.MESSAGE_RECEIVED,
      title: 'Message Received',
      ...dataOverrides,
    },
  }) as unknown as WorkflowNode

/** Build one `ConditionGroup` (AND'd conditions) for `node.data.conditions`. */
function conditionGroup(
  conditions: Array<Partial<Condition> & Pick<Condition, 'fieldId'>>
): ConditionGroup {
  return {
    id: 'g1',
    logicalOperator: 'AND',
    conditions: conditions.map(
      (c, i) => ({ id: c.id ?? `c${i}`, operator: 'is', value: '', ...c }) as Condition
    ),
  }
}

/** A hydrated inbound message, optionally carrying a thread with a primary record. */
const message = (thread?: Record<string, unknown>, overrides: Record<string, unknown> = {}) => ({
  id: 'msg-1',
  threadId: 'thread-1',
  subject: 'Where is my order?',
  textPlain: 'It never arrived.',
  textHtml: '<p>It never arrived.</p>',
  isInbound: true,
  hasAttachments: false,
  receivedAt: new Date('2026-08-11T10:00:00.000Z'),
  from: { identifier: 'priya@example.com', name: 'Priya' },
  participants: [
    { role: ParticipantRole.TO, participant: { identifier: 'support@shop.com', name: 'Support' } },
    { role: ParticipantRole.CC, participant: { identifier: 'boss@shop.com', name: 'Boss' } },
  ],
  thread,
  ...overrides,
})

describe('MessageReceivedProcessor', () => {
  let processor: MessageReceivedProcessor
  let contextManager: ExecutionContextManager

  const run = async (
    thread?: Record<string, unknown>,
    overrides?: Record<string, unknown>,
    nodeDataOverrides?: Record<string, unknown>
  ) => {
    contextManager.initializeWithTrigger({
      type: WorkflowNodeType.MESSAGE_RECEIVED,
      data: { message: message(thread, overrides) },
      timestamp: new Date(),
    } as never)
    const node = triggerNode(nodeDataOverrides)
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

  describe('the message container', () => {
    // The picker offers `message` and `message.from` as selectable OBJECT
    // variables wherever the field carries no type filter, so both container
    // paths have to resolve — not just the leaves under them.
    it('publishes the whole message object at `message`', async () => {
      await run()

      await expect(contextManager.getVariable('trigger-001.message')).resolves.toEqual({
        id: 'msg-1',
        thread_id: 'thread-1',
        from: { email: 'priya@example.com', name: 'Priya' },
        to: [{ email: 'support@shop.com', name: 'Support' }],
        subject: 'Where is my order?',
        body: 'It never arrived.',
        html: '<p>It never arrived.</p>',
        received_at: '2026-08-11T10:00:00.000Z',
        has_attachments: false,
        attachments: [],
      })
    })

    it('resolves `message.from` and every leaf out of the container', async () => {
      await run()

      await expect(contextManager.getVariable('trigger-001.message.from')).resolves.toEqual({
        email: 'priya@example.com',
        name: 'Priya',
      })
      await expect(contextManager.getVariable('trigger-001.message.from.email')).resolves.toBe(
        'priya@example.com'
      )
      await expect(contextManager.getVariable('trigger-001.message.from.name')).resolves.toBe(
        'Priya'
      )
      await expect(contextManager.getVariable('trigger-001.message.subject')).resolves.toBe(
        'Where is my order?'
      )
      await expect(contextManager.getVariable('trigger-001.message.body')).resolves.toBe(
        'It never arrived.'
      )
      await expect(contextManager.getVariable('trigger-001.message.thread_id')).resolves.toBe(
        'thread-1'
      )
      await expect(contextManager.getVariable('trigger-001.message.has_attachments')).resolves.toBe(
        false
      )
      await expect(contextManager.getVariable('trigger-001.message.attachments')).resolves.toEqual(
        []
      )
    })

    it('resolves the `to[*]` picker paths through the container', async () => {
      await run()

      // `message.to` carries only the TO participants — CC is a different role.
      await expect(contextManager.getVariable('trigger-001.message.to[*].email')).resolves.toEqual([
        'support@shop.com',
      ])
      await expect(contextManager.getVariable('trigger-001.message.to[0].name')).resolves.toBe(
        'Support'
      )
    })

    it('interpolates a container reference rather than dropping it', async () => {
      await run()

      // `{{trigger-001.message}}` is insertable from the picker, so it has to
      // render as the message rather than collapse to an empty string.
      const rendered = await contextManager.interpolateVariables('X{{trigger-001.message}}X')
      expect(rendered).toContain('priya@example.com')
      expect(rendered).not.toBe('XX')
    })

    it('publishes `from: null` when the message has no sender', async () => {
      await run(undefined, { from: null })

      await expect(contextManager.getVariable('trigger-001.message.from')).resolves.toBeNull()
      await expect(
        contextManager.getVariable('trigger-001.message.from.email')
      ).resolves.toBeUndefined()
    })

    it('normalises `received_at` to an ISO string', async () => {
      await run(undefined, { receivedAt: '2026-08-11T10:00:00.000Z' })
      await expect(contextManager.getVariable('trigger-001.message.received_at')).resolves.toBe(
        '2026-08-11T10:00:00.000Z'
      )

      // An unparseable timestamp falls back to now instead of throwing.
      contextManager = new ExecutionContextManager('workflow-1', 'exec-2', 'org-1', 'user-1')
      await run(undefined, { receivedAt: 'not a date' })
      await expect(contextManager.getVariable('trigger-001.message.received_at')).resolves.toMatch(
        /^\d{4}-\d{2}-\d{2}T/
      )
    })
  })

  describe('trigger conditions', () => {
    it('fires when the conditions match', async () => {
      const result = await run(undefined, undefined, {
        conditions: [
          conditionGroup([{ fieldId: 'subject', operator: 'contains', value: 'order' }]),
        ],
      })

      expect(result.status).toBe(NodeRunningStatus.Succeeded)
    })

    it('skips with a clear reason when the conditions do not match', async () => {
      const result = await run(undefined, undefined, {
        conditions: [
          conditionGroup([{ fieldId: 'subject', operator: 'contains', value: 'refund' }]),
        ],
      })

      expect(result.status).toBe(NodeRunningStatus.Skipped)
      expect(result.output).toEqual({ filtered: true, reason: 'Did not pass trigger conditions' })
    })

    it('fires on undefined or empty conditions — no conditions configured matches every message', async () => {
      const noKey = await run(undefined, undefined, {})
      expect(noKey.status).toBe(NodeRunningStatus.Succeeded)

      contextManager = new ExecutionContextManager('workflow-1', 'exec-2', 'org-1', 'user-1')
      const empty = await run(undefined, undefined, { conditions: [] })
      expect(empty.status).toBe(NodeRunningStatus.Succeeded)
    })

    it('skips (fails closed) when a condition carries an unrecognised operator', async () => {
      const result = await run(undefined, undefined, {
        conditions: [
          conditionGroup([{ fieldId: 'subject', operator: 'is_the_moon' as never, value: 'x' }]),
        ],
      })

      expect(result.status).toBe(NodeRunningStatus.Skipped)
      expect(result.output).toEqual({ filtered: true, reason: 'Did not pass trigger conditions' })
    })

    it('ignores legacy `filters`/`message_filter` keys from an old graph rather than erroring', async () => {
      const result = await run(undefined, undefined, {
        filters: { from: [], subject_contains: [], body_contains: [] },
        message_filter: { enabled: true, conditions: [] },
      })

      expect(result.status).toBe(NodeRunningStatus.Succeeded)
    })
  })
})
