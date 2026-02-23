// packages/lib/src/workflow-engine/nodes/action-nodes/__tests__/find-thread-message.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowNode } from '../../../core/types'
import { WorkflowNodeType } from '../../../core/types'
import { FindProcessor } from '../find'

/**
 * Test suite for Find node with thread and message resources
 *
 * These tests ensure that the Find node can correctly query thread and message
 * resources using the registry-based system.
 */
describe('FindProcessor - Thread and Message Support', () => {
  let findProcessor: FindProcessor
  let mockContextManager: any

  beforeEach(() => {
    findProcessor = new FindProcessor()

    // Mock ExecutionContextManager
    mockContextManager = {
      getVariable: vi.fn((path: string) => {
        // Mock system variables
        if (path === 'sys.organizationId') return 'org_test_123'
        if (path === 'sys.userId') return 'user_test_123'
        return undefined
      }),
      setNodeVariable: vi.fn(),
      log: vi.fn(),
      getContext: vi.fn(() => ({
        organizationId: 'org_test_123',
        userId: 'user_test_123',
      })),
    }
  })

  describe('Thread Resource', () => {
    it('should validate thread as a supported resource type', async () => {
      const node: WorkflowNode = {
        nodeId: 'find_thread_1',
        name: 'Find Thread',
        type: WorkflowNodeType.FIND,
        position: { x: 0, y: 0 },
        data: {
          resourceType: 'thread',
          findMode: 'findOne',
          conditions: [],
          conditionGroups: [],
        },
      }

      const result = await findProcessor.validate(node)

      // Should validate successfully
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should support thread status field in conditions', async () => {
      const node: WorkflowNode = {
        nodeId: 'find_thread_2',
        name: 'Find Open Threads',
        type: WorkflowNodeType.FIND,
        position: { x: 0, y: 0 },
        data: {
          resourceType: 'thread',
          findMode: 'findMany',
          conditions: [
            {
              id: 'cond_1',
              fieldId: 'status',
              operator: 'is',
              value: 'OPEN',
            },
          ],
          conditionGroups: [],
        },
      }

      const result = await findProcessor.validate(node)

      // Should validate successfully with ENUM field
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should support thread subject field filtering', async () => {
      const node: WorkflowNode = {
        nodeId: 'find_thread_3',
        name: 'Find Thread by Subject',
        type: WorkflowNodeType.FIND,
        position: { x: 0, y: 0 },
        data: {
          resourceType: 'thread',
          findMode: 'findOne',
          conditions: [
            {
              id: 'cond_1',
              fieldId: 'subject',
              operator: 'contains',
              value: 'Order',
            },
          ],
          conditionGroups: [],
        },
      }

      const result = await findProcessor.validate(node)

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should support thread messageCount field for sorting', async () => {
      const node: WorkflowNode = {
        nodeId: 'find_thread_4',
        name: 'Find Threads by Message Count',
        type: WorkflowNodeType.FIND,
        position: { x: 0, y: 0 },
        data: {
          resourceType: 'thread',
          findMode: 'findMany',
          conditions: [],
          conditionGroups: [],
          orderBy: {
            field: 'messageCount',
            direction: 'desc',
          },
        },
      }

      const result = await findProcessor.validate(node)

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should support thread date fields (firstMessageAt, lastMessageAt)', async () => {
      const node: WorkflowNode = {
        nodeId: 'find_thread_5',
        name: 'Find Recent Threads',
        type: WorkflowNodeType.FIND,
        position: { x: 0, y: 0 },
        data: {
          resourceType: 'thread',
          findMode: 'findMany',
          conditions: [
            {
              id: 'cond_1',
              fieldId: 'lastMessageAt',
              operator: 'after',
              value: '2024-01-01T00:00:00Z',
            },
          ],
          conditionGroups: [],
          orderBy: {
            field: 'lastMessageAt',
            direction: 'desc',
          },
        },
      }

      const result = await findProcessor.validate(node)

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })
  })

  describe('Message Resource', () => {
    it('should validate message as a supported resource type', async () => {
      const node: WorkflowNode = {
        nodeId: 'find_message_1',
        name: 'Find Message',
        type: WorkflowNodeType.FIND,
        position: { x: 0, y: 0 },
        data: {
          resourceType: 'message',
          findMode: 'findOne',
          conditions: [],
          conditionGroups: [],
        },
      }

      const result = await findProcessor.validate(node)

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should support message isInbound boolean field', async () => {
      const node: WorkflowNode = {
        nodeId: 'find_message_2',
        name: 'Find Inbound Messages',
        type: WorkflowNodeType.FIND,
        position: { x: 0, y: 0 },
        data: {
          resourceType: 'message',
          findMode: 'findMany',
          conditions: [
            {
              id: 'cond_1',
              fieldId: 'isInbound',
              operator: 'is',
              value: true,
            },
          ],
          conditionGroups: [],
        },
      }

      const result = await findProcessor.validate(node)

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should support message isFirstInThread boolean field', async () => {
      const node: WorkflowNode = {
        nodeId: 'find_message_3',
        name: 'Find First Messages in Thread',
        type: WorkflowNodeType.FIND,
        position: { x: 0, y: 0 },
        data: {
          resourceType: 'message',
          findMode: 'findMany',
          conditions: [
            {
              id: 'cond_1',
              fieldId: 'isFirstInThread',
              operator: 'is',
              value: true,
            },
          ],
          conditionGroups: [],
        },
      }

      const result = await findProcessor.validate(node)

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should support message text content filtering', async () => {
      const node: WorkflowNode = {
        nodeId: 'find_message_4',
        name: 'Find Messages by Content',
        type: WorkflowNodeType.FIND,
        position: { x: 0, y: 0 },
        data: {
          resourceType: 'message',
          findMode: 'findMany',
          conditions: [
            {
              id: 'cond_1',
              fieldId: 'textPlain',
              operator: 'contains',
              value: 'refund',
            },
          ],
          conditionGroups: [],
        },
      }

      const result = await findProcessor.validate(node)

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should support message date fields (sentAt, receivedAt)', async () => {
      const node: WorkflowNode = {
        nodeId: 'find_message_5',
        name: 'Find Recent Messages',
        type: WorkflowNodeType.FIND,
        position: { x: 0, y: 0 },
        data: {
          resourceType: 'message',
          findMode: 'findMany',
          conditions: [
            {
              id: 'cond_1',
              fieldId: 'receivedAt',
              operator: 'after',
              value: '2024-01-01T00:00:00Z',
            },
          ],
          conditionGroups: [],
          orderBy: {
            field: 'receivedAt',
            direction: 'desc',
          },
        },
      }

      const result = await findProcessor.validate(node)

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })
  })

  describe('Relation Fields', () => {
    it('should support thread assignee relation field', async () => {
      const node: WorkflowNode = {
        nodeId: 'find_thread_6',
        name: 'Find Threads by Assignee',
        type: WorkflowNodeType.FIND,
        position: { x: 0, y: 0 },
        data: {
          resourceType: 'thread',
          findMode: 'findMany',
          conditions: [
            {
              id: 'cond_1',
              fieldId: 'assignee',
              operator: 'is',
              value: 'user_123',
            },
          ],
          conditionGroups: [],
        },
      }

      const result = await findProcessor.validate(node)

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should support message thread relation field', async () => {
      const node: WorkflowNode = {
        nodeId: 'find_message_6',
        name: 'Find Messages by Thread',
        type: WorkflowNodeType.FIND,
        position: { x: 0, y: 0 },
        data: {
          resourceType: 'message',
          findMode: 'findMany',
          conditions: [
            {
              id: 'cond_1',
              fieldId: 'thread',
              operator: 'is',
              value: 'thread_abc123',
            },
          ],
          conditionGroups: [],
        },
      }

      const result = await findProcessor.validate(node)

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should support message from participant relation field', async () => {
      const node: WorkflowNode = {
        nodeId: 'find_message_7',
        name: 'Find Messages from Participant',
        type: WorkflowNodeType.FIND,
        position: { x: 0, y: 0 },
        data: {
          resourceType: 'message',
          findMode: 'findMany',
          conditions: [
            {
              id: 'cond_1',
              fieldId: 'from',
              operator: 'is',
              value: 'participant_xyz',
            },
          ],
          conditionGroups: [],
        },
      }

      const result = await findProcessor.validate(node)

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })
  })

  describe('Error Handling', () => {
    it('should pass validation for enum values (runtime validation catches invalid values)', async () => {
      // Note: The validateNodeConfig method does NOT validate enum values at design time.
      // Enum value validation happens at execution time in validateConditionValues.
      // At design time, validation only checks field existence and operator validity.
      const node: WorkflowNode = {
        nodeId: 'find_thread_7',
        name: 'Find Thread - Invalid Status',
        type: WorkflowNodeType.FIND,
        position: { x: 0, y: 0 },
        data: {
          resourceType: 'thread',
          findMode: 'findOne',
          conditions: [
            {
              id: 'cond_1',
              fieldId: 'status',
              operator: 'is',
              value: 'INVALID_STATUS',
            },
          ],
          conditionGroups: [],
        },
      }

      const result = await findProcessor.validate(node)

      // Design-time validation passes because the field and operator are valid
      // Invalid enum values are caught at execution time
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should reject removed messageType field (no longer in schema)', async () => {
      // messageType was removed from the message schema - it's now derived from Integration.provider
      const node: WorkflowNode = {
        nodeId: 'find_message_8',
        name: 'Find Message - Removed Field',
        type: WorkflowNodeType.FIND,
        position: { x: 0, y: 0 },
        data: {
          resourceType: 'message',
          findMode: 'findOne',
          conditions: [
            {
              id: 'cond_1',
              fieldId: 'messageType',
              operator: 'is',
              value: 'EMAIL',
            },
          ],
          conditionGroups: [],
        },
      }

      const result = await findProcessor.validate(node)

      expect(result.valid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
      expect(result.errors[0]).toContain('Invalid field')
    })

    it('should reject unknown thread field', async () => {
      const node: WorkflowNode = {
        nodeId: 'find_thread_8',
        name: 'Find Thread - Unknown Field',
        type: WorkflowNodeType.FIND,
        position: { x: 0, y: 0 },
        data: {
          resourceType: 'thread',
          findMode: 'findOne',
          conditions: [
            {
              id: 'cond_1',
              fieldId: 'nonexistentField',
              operator: 'is',
              value: 'test',
            },
          ],
          conditionGroups: [],
        },
      }

      const result = await findProcessor.validate(node)

      expect(result.valid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
      expect(result.errors[0]).toContain('Invalid field')
    })
  })
})
