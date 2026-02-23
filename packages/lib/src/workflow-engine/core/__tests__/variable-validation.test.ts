// packages/lib/src/workflow-engine/core/__tests__/variable-validation.test.ts

import { beforeEach, describe, expect, it } from 'vitest'
import { BaseNodeProcessor } from '../../nodes/base-node'
import { WorkflowNodeValidationError } from '../errors'
import { ExecutionContextManager } from '../execution-context'
import {
  type NodeExecutionResult,
  NodeRunningStatus,
  type ValidationResult,
  type WorkflowNode,
  WorkflowNodeType,
} from '../types'

/**
 * Mock node processor that extracts variables from its config
 * Simulates nodes like AI that have variable references in their configuration
 */
class VariableRequiringNodeProcessor extends BaseNodeProcessor {
  readonly type: WorkflowNodeType = WorkflowNodeType.AI

  protected extractRequiredVariables(node: WorkflowNode): string[] {
    const data = node.data
    const variables: string[] = []

    // Extract variables from a mock prompt template field
    if (data.prompt && typeof data.prompt === 'string') {
      const matches = data.prompt.matchAll(/\{\{([^}]+)\}\}/g)
      for (const match of matches) {
        if (match[1]) {
          variables.push(match[1].trim())
        }
      }
    }

    return variables
  }

  protected async executeNode(
    node: WorkflowNode,
    contextManager: ExecutionContextManager
  ): Promise<Partial<NodeExecutionResult>> {
    const data = node.data
    // Simulate processing with the variables
    const prompt = data.prompt as string
    const processedPrompt = contextManager.interpolateVariables(prompt)

    return {
      status: NodeRunningStatus.Succeeded,
      output: { processedPrompt },
    }
  }

  protected async validateNodeConfig(): Promise<ValidationResult> {
    return { valid: true, errors: [], warnings: [] }
  }
}

describe('Variable Validation - Integration Tests', () => {
  let contextManager: ExecutionContextManager
  let processor: VariableRequiringNodeProcessor

  beforeEach(() => {
    contextManager = new ExecutionContextManager(
      'test-workflow',
      'test-exec',
      'test-org',
      'test-user',
      'test@example.com',
      'Test User',
      'Test Org',
      'test-org-handle'
    )
    processor = new VariableRequiringNodeProcessor()
  })

  describe('Strict Validation Mode', () => {
    it('should fail execution when required variable is missing', async () => {
      // Set validation mode to strict
      contextManager.setOptions({ variableValidationMode: 'strict' })

      // Create node that requires a variable that doesn't exist
      const node: WorkflowNode = {
        id: 'node-1',
        workflowId: 'test-workflow',
        nodeId: 'ai1',
        type: WorkflowNodeType.AI,
        name: 'Test AI Node',
        data: {
          id: 'ai1',
          type: 'ai',
          title: 'Test AI',
          prompt: 'Process ticket: {{find1.ticket.title}}',
        },
      }

      // Execute should throw validation error
      await expect(processor.execute(node, contextManager)).rejects.toThrow(
        WorkflowNodeValidationError
      )

      await expect(processor.execute(node, contextManager)).rejects.toThrow(
        /requires variables that are not available/
      )
    })

    it('should succeed when all required variables are present', async () => {
      // Set validation mode to strict
      contextManager.setOptions({ variableValidationMode: 'strict' })

      // Set up required variable
      contextManager.setVariable('webhook1.body.email', 'test@example.com')

      const node: WorkflowNode = {
        id: 'node-1',
        workflowId: 'test-workflow',
        nodeId: 'ai1',
        type: WorkflowNodeType.AI,
        name: 'Test AI Node',
        data: {
          id: 'ai1',
          type: 'ai',
          title: 'Test AI',
          prompt: 'Email from: {{webhook1.body.email}}',
        },
      }

      const result = await processor.execute(node, contextManager)

      expect(result.status).toBe(NodeRunningStatus.Succeeded)
      expect(result.metadata?.requiredVariables).toContain('webhook1.body.email')
    })

    it('should provide detailed error with similar variables', async () => {
      // Set validation mode to strict
      contextManager.setOptions({ variableValidationMode: 'strict' })

      // Set up similar but not exact variables
      contextManager.setVariable('find1.ticket.id', '123')
      contextManager.setVariable('find1.ticket.status', 'OPEN')

      const node: WorkflowNode = {
        id: 'node-1',
        workflowId: 'test-workflow',
        nodeId: 'ai1',
        type: WorkflowNodeType.AI,
        name: 'Test AI Node',
        data: {
          id: 'ai1',
          type: 'ai',
          title: 'Test AI',
          prompt: 'Process: {{find1.ticket.title}}',
        },
      }

      try {
        await processor.execute(node, contextManager)
        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).toBeInstanceOf(WorkflowNodeValidationError)
        const errorMessage = (error as Error).message
        expect(errorMessage).toContain('find1.ticket.title')
        expect(errorMessage).toContain('Similar variables available')
        expect(errorMessage).toContain('find1.ticket.id')
        expect(errorMessage).toContain('find1.ticket.status')
      }
    })
  })

  describe('Warn Validation Mode (Default)', () => {
    it('should continue execution with warning when variable missing', async () => {
      // Default mode is 'warn'
      const node: WorkflowNode = {
        id: 'node-1',
        workflowId: 'test-workflow',
        nodeId: 'ai1',
        type: WorkflowNodeType.AI,
        name: 'Test AI Node',
        data: {
          id: 'ai1',
          type: 'ai',
          title: 'Test AI',
          prompt: 'Process: {{find1.ticket.title}}',
        },
      }

      // Should not throw, but should log warning
      const result = await processor.execute(node, contextManager)

      expect(result.status).toBe(NodeRunningStatus.Succeeded)

      // Check that warning was logged
      const logs = contextManager.getLogs()
      const warnings = logs.filter((log) => log.level === 'WARN')
      expect(warnings.length).toBeGreaterThan(0)
      expect(warnings[0]?.message).toContain('requires variables that are not available')
    })

    it('should succeed normally when all variables present', async () => {
      contextManager.setVariable('webhook1.body.email', 'test@example.com')

      const node: WorkflowNode = {
        id: 'node-1',
        workflowId: 'test-workflow',
        nodeId: 'ai1',
        type: WorkflowNodeType.AI,
        name: 'Test AI Node',
        data: {
          id: 'ai1',
          type: 'ai',
          title: 'Test AI',
          prompt: 'Email: {{webhook1.body.email}}',
        },
      }

      const result = await processor.execute(node, contextManager)

      expect(result.status).toBe(NodeRunningStatus.Succeeded)

      // Should log success message, not warning
      const logs = contextManager.getLogs()
      const debugLogs = logs.filter((log) => log.level === 'DEBUG' && log.nodeId === 'Test AI Node')
      const successLog = debugLogs.find((log) => log.message.includes('All required variables'))
      expect(successLog).toBeDefined()
    })
  })

  describe('Off Validation Mode', () => {
    it('should skip validation entirely', async () => {
      contextManager.setOptions({ variableValidationMode: 'off' })

      const node: WorkflowNode = {
        id: 'node-1',
        workflowId: 'test-workflow',
        nodeId: 'ai1',
        type: WorkflowNodeType.AI,
        name: 'Test AI Node',
        data: {
          id: 'ai1',
          type: 'ai',
          title: 'Test AI',
          prompt: 'Process: {{find1.ticket.title}}',
        },
      }

      // Should succeed without any validation
      const result = await processor.execute(node, contextManager)

      expect(result.status).toBe(NodeRunningStatus.Succeeded)

      // Should not log any variable validation warnings
      const logs = contextManager.getLogs()
      const validationLogs = logs.filter(
        (log) => log.message.includes('requires variables') || log.message.includes('All required')
      )
      expect(validationLogs.length).toBe(0)
    })
  })

  describe('Multiple Variables', () => {
    it('should validate multiple variables correctly', async () => {
      contextManager.setOptions({ variableValidationMode: 'strict' })
      contextManager.setVariable('webhook1.body.email', 'test@example.com')
      contextManager.setVariable('find1.ticket.id', '123')

      const node: WorkflowNode = {
        id: 'node-1',
        workflowId: 'test-workflow',
        nodeId: 'ai1',
        type: WorkflowNodeType.AI,
        name: 'Test AI Node',
        data: {
          id: 'ai1',
          type: 'ai',
          title: 'Test AI',
          prompt: 'Email: {{webhook1.body.email}}, Ticket: {{find1.ticket.id}}',
        },
      }

      const result = await processor.execute(node, contextManager)

      expect(result.status).toBe(NodeRunningStatus.Succeeded)
      expect(result.metadata?.requiredVariables).toHaveLength(2)
      expect(result.metadata?.variablesUsed).toBe(2)
    })

    it('should report all missing variables', async () => {
      contextManager.setOptions({ variableValidationMode: 'strict' })
      contextManager.setVariable('webhook1.body.email', 'test@example.com')

      const node: WorkflowNode = {
        id: 'node-1',
        workflowId: 'test-workflow',
        nodeId: 'ai1',
        type: WorkflowNodeType.AI,
        name: 'Test AI Node',
        data: {
          id: 'ai1',
          type: 'ai',
          title: 'Test AI',
          prompt:
            'Email: {{webhook1.body.email}}, Ticket: {{find1.ticket.id}}, Status: {{find1.ticket.status}}',
        },
      }

      try {
        await processor.execute(node, contextManager)
        expect.fail('Should have thrown error')
      } catch (error) {
        const errorMessage = (error as Error).message
        // Check that missing variables are listed
        expect(errorMessage).toContain('find1.ticket.id')
        expect(errorMessage).toContain('find1.ticket.status')
        // Check that available variable appears in "Available variables" section
        expect(errorMessage).toContain('webhook1.body.email')
        // Check that it's in the right section (not in Missing variables)
        const lines = errorMessage.split('\n')
        const missingSection = lines.slice(
          lines.findIndex((l) => l.includes('Missing variables')),
          lines.findIndex((l) => l.includes('Available variables'))
        )
        const missingText = missingSection.join('\n')
        expect(missingText).not.toContain('webhook1.body.email')
      }
    })
  })

  describe('Context Optimization Helper Methods', () => {
    it('should build optimized context with only required variables', async () => {
      contextManager.setVariable('webhook1.body.email', 'test@example.com')
      contextManager.setVariable('webhook1.body.subject', 'Test Subject')
      contextManager.setVariable('webhook1.headers.contentType', 'application/json')
      contextManager.setVariable('find1.ticket.id', '123')

      const node: WorkflowNode = {
        id: 'node-1',
        workflowId: 'test-workflow',
        nodeId: 'ai1',
        type: WorkflowNodeType.AI,
        name: 'Test AI Node',
        data: {
          id: 'ai1',
          type: 'ai',
          title: 'Test AI',
          prompt: 'Email: {{webhook1.body.email}}',
        },
      }

      // Get optimized context using the helper method (async since buildOptimizedContext is async)
      const optimizedContext = await (processor as any).getOptimizedContext(node, contextManager)

      // Should only include the one variable used in the prompt
      expect(optimizedContext.size).toBe(1)
      expect(optimizedContext.get('webhook1.body.email')).toBe('test@example.com')
      expect(optimizedContext.has('webhook1.body.subject')).toBe(false)
      expect(optimizedContext.has('webhook1.headers.contentType')).toBe(false)
      expect(optimizedContext.has('find1.ticket.id')).toBe(false)
    })

    it('should convert optimized context to plain object', async () => {
      contextManager.setVariable('webhook1.body.email', 'test@example.com')
      contextManager.setVariable('find1.ticket.id', '123')

      const node: WorkflowNode = {
        id: 'node-1',
        workflowId: 'test-workflow',
        nodeId: 'ai1',
        type: WorkflowNodeType.AI,
        name: 'Test AI Node',
        data: {
          id: 'ai1',
          type: 'ai',
          title: 'Test AI',
          prompt: 'Email: {{webhook1.body.email}}, ID: {{find1.ticket.id}}',
        },
      }

      const optimizedContext = await (processor as any).getOptimizedContext(node, contextManager)
      const contextObject = (processor as any).buildContextObject(optimizedContext)

      expect(contextObject).toEqual({
        'webhook1.body.email': 'test@example.com',
        'find1.ticket.id': '123',
      })

      // Should be a plain object, not a Map
      expect(contextObject.constructor.name).toBe('Object')
    })
  })

  describe('Node with no variables', () => {
    it('should handle nodes with no variable requirements', async () => {
      contextManager.setOptions({ variableValidationMode: 'strict' })

      const node: WorkflowNode = {
        id: 'node-1',
        workflowId: 'test-workflow',
        nodeId: 'ai1',
        type: WorkflowNodeType.AI,
        name: 'Test AI Node',
        data: {
          id: 'ai1',
          type: 'ai',
          title: 'Test AI',
          prompt: 'Static prompt with no variables',
        },
      }

      const result = await processor.execute(node, contextManager)

      expect(result.status).toBe(NodeRunningStatus.Succeeded)
      expect(result.metadata?.requiredVariables).toEqual([])
      expect(result.metadata?.variablesUsed).toBe(0)
    })
  })

  describe('Metadata tracking', () => {
    it('should include variable metadata in result', async () => {
      contextManager.setVariable('webhook1.body.email', 'test@example.com')

      const node: WorkflowNode = {
        id: 'node-1',
        workflowId: 'test-workflow',
        nodeId: 'ai1',
        type: WorkflowNodeType.AI,
        name: 'Test AI Node',
        data: {
          id: 'ai1',
          type: 'ai',
          title: 'Test AI',
          prompt: 'Email: {{webhook1.body.email}}',
        },
      }

      const result = await processor.execute(node, contextManager)

      expect(result.metadata).toBeDefined()
      expect(result.metadata?.requiredVariables).toEqual(['webhook1.body.email'])
      expect(result.metadata?.variablesUsed).toBe(1)
    })

    it('should log variable usage statistics', async () => {
      contextManager.setVariable('webhook1.body.email', 'test@example.com')

      const node: WorkflowNode = {
        id: 'node-1',
        workflowId: 'test-workflow',
        nodeId: 'ai1',
        type: WorkflowNodeType.AI,
        name: 'Test AI Node',
        data: {
          id: 'ai1',
          type: 'ai',
          title: 'Test AI',
          prompt: 'Email: {{webhook1.body.email}}',
        },
      }

      await processor.execute(node, contextManager)

      const logs = contextManager.getLogs()
      const completionLog = logs.find(
        (log) => log.level === 'INFO' && log.message.includes('Node execution completed')
      )

      expect(completionLog).toBeDefined()
      expect(completionLog?.data).toMatchObject({
        requiredVariables: ['webhook1.body.email'],
        variablesUsed: 1,
      })
    })
  })
})
