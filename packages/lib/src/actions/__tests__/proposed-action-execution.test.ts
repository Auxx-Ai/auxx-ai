// packages/lib/src/actions/__tests__/proposed-action-execution.test.ts

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ProposedActionStatus, ActionType as DbActionType } from '@auxx/database/enums'
import { ServiceRegistry } from '../../services/service-registry'
import { ServiceKeys } from '../../services/service-registrations'
import { ProposedActionExecutionService } from '../services/proposed-action-execution-service'
import { ActionType } from '../core/action-types'

// Mock database
const mockDatabase = {
  proposedAction: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}

// Mock the database
vi.mock('@auxx/database/enums', () => ({
  ProposedActionStatus: {
    pending: 'pending',
    approved: 'approved',
    executed: 'executed',
    failed: 'failed',
    rejected: 'rejected',
  },
  ActionType: {
    send_message: 'send_message',
    apply_tag: 'apply_tag',
    reply: 'reply',
  },
}))

// Mock the ActionExecutor
const mockActionExecutor = {
  execute: vi.fn(),
  initialize: vi.fn(),
}

describe('ProposedActionExecutionService', () => {
  let service: ProposedActionExecutionService
  let registry: ServiceRegistry

  beforeEach(() => {
    vi.clearAllMocks()

    // Create mock service registry
    registry = new ServiceRegistry('test')
    registry.registerSingleton(ServiceKeys.ORGANIZATION_ID, () => 'test-org')
    registry.registerSingleton(ServiceKeys.USER_ID, () => 'test-user')
    registry.registerSingleton(ServiceKeys.DATABASE, () => mockDatabase)
    registry.registerSingleton(ServiceKeys.ACTION_EXECUTOR, () => mockActionExecutor as any)

    service = new ProposedActionExecutionService(registry)
  })

  describe('executeAction', () => {
    it('should handle new schema fields correctly', async () => {
      // Mock proposed action with new schema fields
      const mockProposedAction = {
        id: 'test-action-id',
        organizationId: 'test-org',
        actionType: DbActionType.reply,
        actionParams: { content: 'Test reply' },
        modifiedParams: null,
        confidence: 0.85,
        explanation: 'High confidence reply based on customer inquiry pattern',
        executionResult: null,
        executionMetadata: null,
        status: ProposedActionStatus.approved,
        message: {
          id: 'test-message-id',
          threadId: 'test-thread-id',
          subject: 'Test Subject',
          text: 'Test message content',
          participants: [
            { type: 'FROM', participant: { email: 'customer@example.com' } },
            { type: 'TO', participant: { email: 'support@example.com' } },
          ],
          thread: { subject: 'Test Thread', integrationId: 'test-integration' },
        },
        rule: {
          id: 'test-rule-id',
          name: 'Test Rule',
          type: 'ai',
        },
      }

      // Mock database response
      vi.mocked(mockDatabase.proposedAction.findFirst).mockResolvedValue(mockProposedAction as any)

      // Mock successful action execution
      const mockExecutionResult = {
        actionId: 'test-action-id',
        actionType: DbActionType.reply,
        success: true,
        error: null,
        executionTime: Date.now(),
        metadata: {
          executionId: 'exec-123',
          duration: 500,
        },
      }
      mockActionExecutor.execute.mockResolvedValue(mockExecutionResult)

      // Mock database update
      vi.mocked(mockDatabase.proposedAction.update).mockResolvedValue({} as any)

      // Execute the action
      await service.initialize()
      const result = await service.executeAction('test-action-id')

      // Verify the execution result
      expect(result.success).toBe(true)
      expect(result.actionType).toBe(ActionType.REPLY)

      // Verify the action executor was called with correct parameters
      expect(mockActionExecutor.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'test-action-id',
          type: ActionType.REPLY,
          params: expect.objectContaining({
            content: 'Test reply',
            confidence: 0.85,
            explanation: 'High confidence reply based on customer inquiry pattern',
          }),
          metadata: expect.objectContaining({
            proposedActionId: 'test-action-id',
            ruleId: 'test-rule-id',
            confidence: 0.85,
            explanation: 'High confidence reply based on customer inquiry pattern',
          }),
        }),
        expect.objectContaining({
          userId: 'test-user',
          organizationId: 'test-org',
        })
      )

      // Verify database was updated with execution results
      expect(mockDatabase.proposedAction.update).toHaveBeenCalledWith({
        where: { id: 'test-action-id' },
        data: {
          status: ProposedActionStatus.executed,
          executedAt: expect.any(Date),
          executionError: null,
          executionResult: mockExecutionResult,
          executionMetadata: mockExecutionResult.metadata,
        },
      })
    })

    it('should handle execution failures and update metadata', async () => {
      const mockProposedAction = {
        id: 'test-action-id',
        organizationId: 'test-org',
        actionType: DbActionType.apply_tag,
        actionParams: { tagName: 'urgent' },
        confidence: 0.6,
        explanation: 'Medium confidence tag application',
        status: ProposedActionStatus.approved,
        message: {
          id: 'test-message-id',
          threadId: 'test-thread-id',
          participants: [
            { type: 'FROM', participant: { email: 'customer@example.com' } },
            { type: 'TO', participant: { email: 'support@example.com' } },
          ],
          thread: { integrationId: 'test-integration' },
        },
        rule: { id: 'test-rule-id', name: 'Test Rule', type: 'static' },
      }

      vi.mocked(mockDatabase.proposedAction.findFirst).mockResolvedValue(mockProposedAction as any)

      // Mock action execution failure
      const error = new Error('Tag application failed')
      mockActionExecutor.execute.mockRejectedValue(error)

      // Mock database update for error
      vi.mocked(mockDatabase.proposedAction.update).mockResolvedValue({} as any)

      await service.initialize()
      const result = await service.executeAction('test-action-id')

      // Verify failure handling
      expect(result.success).toBe(false)
      expect(result.error).toBe('Tag application failed')

      // Verify database was updated with error
      expect(mockDatabase.proposedAction.update).toHaveBeenCalledWith({
        where: { id: 'test-action-id' },
        data: {
          status: ProposedActionStatus.failed,
          executionError: 'Tag application failed',
          executionMetadata: {
            error: 'Tag application failed',
            failedAt: expect.any(String),
            executionSource: 'proposed-action-service',
          },
        },
      })
    })

    it('should handle missing confidence and explanation gracefully', async () => {
      const mockProposedAction = {
        id: 'test-action-id',
        organizationId: 'test-org',
        actionType: DbActionType.send_message,
        actionParams: { content: 'Test message' },
        confidence: null,
        explanation: null,
        status: ProposedActionStatus.approved,
        message: {
          id: 'test-message-id',
          threadId: 'test-thread-id',
          participants: [
            { type: 'FROM', participant: { email: 'customer@example.com' } },
            { type: 'TO', participant: { email: 'support@example.com' } },
          ],
          thread: { integrationId: 'test-integration' },
        },
        rule: { id: 'test-rule-id', name: 'Manual Rule', type: 'static' },
      }

      vi.mocked(mockDatabase.proposedAction.findFirst).mockResolvedValue(mockProposedAction as any)

      const mockExecutionResult = {
        actionId: 'test-action-id',
        actionType: DbActionType.send_message,
        success: true,
        error: null,
        executionTime: Date.now(),
        metadata: {},
      }
      mockActionExecutor.execute.mockResolvedValue(mockExecutionResult)
      vi.mocked(mockDatabase.proposedAction.update).mockResolvedValue({} as any)

      await service.initialize()
      const result = await service.executeAction('test-action-id')

      expect(result.success).toBe(true)

      // Verify that missing confidence/explanation don't break the execution
      expect(mockActionExecutor.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            content: 'Test message',
            confidence: null,
            explanation: null,
          }),
          metadata: expect.objectContaining({
            confidence: null,
            explanation: null,
          }),
        }),
        expect.any(Object)
      )
    })
  })

  describe('executeBatch', () => {
    it('should handle batch execution with new schema fields', async () => {
      const mockProposedActions = [
        {
          id: 'action-1',
          organizationId: 'test-org',
          actionType: DbActionType.reply,
          confidence: 0.9,
          explanation: 'High confidence automated reply',
          status: ProposedActionStatus.approved,
          message: {
            id: 'msg-1',
            threadId: 'thread-1',
            participants: [
              { type: 'FROM', participant: { email: 'c1@example.com' } },
              { type: 'TO', participant: { email: 's@example.com' } },
            ],
            thread: { integrationId: 'int-1' },
          },
          rule: { id: 'rule-1', name: 'Reply Rule', type: 'ai' },
        },
        {
          id: 'action-2',
          organizationId: 'test-org',
          actionType: DbActionType.apply_tag,
          confidence: 0.7,
          explanation: 'Medium confidence tag application',
          status: ProposedActionStatus.approved,
          message: {
            id: 'msg-2',
            threadId: 'thread-2',
            participants: [
              { type: 'FROM', participant: { email: 'c2@example.com' } },
              { type: 'TO', participant: { email: 's@example.com' } },
            ],
            thread: { integrationId: 'int-2' },
          },
          rule: { id: 'rule-2', name: 'Tag Rule', type: 'static' },
        },
      ]

      vi.mocked(mockDatabase.proposedAction.findMany).mockResolvedValue(mockProposedActions as any)

      // Mock successful executions
      mockActionExecutor.execute
        .mockResolvedValueOnce({
          actionId: 'action-1',
          actionType: ActionType.REPLY,
          success: true,
          executionTime: Date.now(),
          metadata: {},
        })
        .mockResolvedValueOnce({
          actionId: 'action-2',
          actionType: ActionType.APPLY_TAG,
          success: true,
          executionTime: Date.now(),
          metadata: {},
        })

      vi.mocked(mockDatabase.proposedAction.update).mockResolvedValue({} as any)

      await service.initialize()
      const results = await service.executeBatch(['action-1', 'action-2'])

      // Verify both actions were executed
      expect(Object.keys(results)).toHaveLength(2)
      expect(results['action-1'].success).toBe(true)
      expect(results['action-2'].success).toBe(true)

      // Verify database was updated for both actions
      expect(mockDatabase.proposedAction.update).toHaveBeenCalledTimes(2)
    })
  })
})
