// packages/lib/src/workflow-engine/testing/enhanced-variable-system.test.ts

import { beforeEach, describe, expect, it } from 'vitest'
import { ExecutionContextManager } from '../core/execution-context'
import { type NodeExecutionResult, type ValidationResult, WorkflowNodeType } from '../core/types'
import { BaseNodeProcessor } from '../nodes/base-node'

// Mock node processor for testing
class TestNodeProcessor extends BaseNodeProcessor {
  readonly type: WorkflowNodeType = WorkflowNodeType.EXECUTE

  protected async executeNode(): Promise<Partial<NodeExecutionResult>> {
    return { status: 'COMPLETED' as any }
  }

  protected async validateNodeConfig(): Promise<ValidationResult> {
    return { valid: true, errors: [], warnings: [] }
  }

  // Expose protected methods for testing
  public testResolveVariableValue(value: any, contextManager: ExecutionContextManager) {
    return this.resolveVariableValue(value, contextManager)
  }

  public testResolveVariablePath(path: string, contextManager: ExecutionContextManager) {
    return this.resolveVariablePath(path, contextManager)
  }

  public testGetNestedProperty(obj: any, path: string) {
    return this.getNestedProperty(obj, path)
  }
}

describe('Enhanced Variable System', () => {
  let contextManager: ExecutionContextManager
  let testProcessor: TestNodeProcessor

  beforeEach(() => {
    contextManager = new ExecutionContextManager('workflow-1', 'exec-1', 'org-1', 'user-1')
    testProcessor = new TestNodeProcessor()
  })

  describe('ExecutionContextManager', () => {
    it('should initialize system variables', async () => {
      contextManager.initializeSystemVariables()

      expect(await contextManager.getVariable('sys.currentTime')).toBeDefined()
      expect(await contextManager.getVariable('sys.userId')).toBe('user-1')
      expect(await contextManager.getVariable('sys.organizationId')).toBe('org-1')
      expect(await contextManager.getVariable('sys.workflowId')).toBe('workflow-1')
      expect(await contextManager.getVariable('sys.executionId')).toBe('exec-1')
    })

    it('should initialize environment variables', async () => {
      const envVars = [
        { name: 'API_KEY', value: 'secret-123', type: 'secret' },
        { name: 'COMPANY_NAME', value: 'Acme Corp', type: 'string' },
        { name: 'MAX_RETRIES', value: 5, type: 'number' },
        { name: 'FEATURES', value: ['feature1', 'feature2'], type: 'array' },
        { name: 'DEBUG_MODE', value: true, type: 'boolean' },
      ]

      contextManager.initializeEnvironmentVariables(envVars)

      expect(await contextManager.getVariable('env.API_KEY')).toBe('secret-123')
      expect(await contextManager.getVariable('env.COMPANY_NAME')).toBe('Acme Corp')
      expect(await contextManager.getVariable('env.MAX_RETRIES')).toBe(5)
      expect(await contextManager.getVariable('env.FEATURES')).toEqual(['feature1', 'feature2'])
      expect(await contextManager.getVariable('env.DEBUG_MODE')).toBe(true)
    })

    it('should initialize schema variables', async () => {
      const messageData = {
        id: 'msg-123',
        subject: 'Test Subject',
        content: { text: 'Hello world' },
        from: { email: 'test@example.com', name: 'John Doe' },
        to: [{ email: 'recipient@example.com', name: 'Jane Smith' }],
        hasAttachments: true,
        wordCount: 25,
      }

      contextManager.initializeSchemaVariables('message', messageData)

      expect(await contextManager.getVariable('message.id')).toBe('msg-123')
      expect(await contextManager.getVariable('message.subject')).toBe('Test Subject')
      expect(await contextManager.getVariable('message.content')).toEqual({ text: 'Hello world' })
      expect(await contextManager.getVariable('message.from')).toEqual({
        email: 'test@example.com',
        name: 'John Doe',
      })
      expect(await contextManager.getVariable('message.hasAttachments')).toBe(true)
      expect(await contextManager.getVariable('message.wordCount')).toBe(25)
    })
  })

  describe('Variable Resolution', () => {
    beforeEach(() => {
      // Set up test data
      contextManager.initializeSystemVariables()
      contextManager.initializeEnvironmentVariables([
        { name: 'API_KEY', value: 'secret-123', type: 'secret' },
        { name: 'COMPANY_NAME', value: 'Acme Corp', type: 'string' },
      ])
      contextManager.initializeSchemaVariables('message', {
        id: 'msg-123',
        subject: 'Order Confirmation',
        content: { text: 'Your order has been confirmed' },
        from: { email: 'orders@shop.com', name: 'Shop Orders' },
        to: [{ email: 'customer@example.com', name: 'John Customer' }],
      })
    })

    it('should resolve simple variable paths', async () => {
      expect(await testProcessor.testResolveVariablePath('sys.userId', contextManager)).toBe(
        'user-1'
      )
      expect(await testProcessor.testResolveVariablePath('env.API_KEY', contextManager)).toBe(
        'secret-123'
      )
      expect(await testProcessor.testResolveVariablePath('message.id', contextManager)).toBe(
        'msg-123'
      )
      expect(await testProcessor.testResolveVariablePath('message.subject', contextManager)).toBe(
        'Order Confirmation'
      )
    })

    it('should resolve nested object paths', async () => {
      expect(
        await testProcessor.testResolveVariablePath('message.content.text', contextManager)
      ).toBe('Your order has been confirmed')
      expect(
        await testProcessor.testResolveVariablePath('message.from.email', contextManager)
      ).toBe('orders@shop.com')
      expect(await testProcessor.testResolveVariablePath('message.from.name', contextManager)).toBe(
        'Shop Orders'
      )
    })

    it('should resolve array access paths', async () => {
      expect(
        await testProcessor.testResolveVariablePath('message.to[0].email', contextManager)
      ).toBe('customer@example.com')
      expect(
        await testProcessor.testResolveVariablePath('message.to[0].name', contextManager)
      ).toBe('John Customer')
    })

    it('should interpolate variables in templates', async () => {
      const template1 = 'Hello {{message.from.name}}, your order {{message.id}} is confirmed!'
      const result1 = await testProcessor.testResolveVariableValue(template1, contextManager)
      expect(result1).toBe('Hello Shop Orders, your order msg-123 is confirmed!')

      const template2 = 'API Key: {{env.API_KEY}}, Company: {{env.COMPANY_NAME}}'
      const result2 = await testProcessor.testResolveVariableValue(template2, contextManager)
      expect(result2).toBe('API Key: secret-123, Company: Acme Corp')

      const template3 = 'Subject: {{message.subject}}, Text: {{message.content.text}}'
      const result3 = await testProcessor.testResolveVariableValue(template3, contextManager)
      expect(result3).toBe('Subject: Order Confirmation, Text: Your order has been confirmed')
    })

    it('should handle missing variables gracefully', async () => {
      const template = 'Value: {{nonexistent.variable}}'
      const result = await testProcessor.testResolveVariableValue(template, contextManager)
      // Should return original template when variable not found
      expect(result).toBe('Value: {{nonexistent.variable}}')
    })

    it('should handle non-string values', async () => {
      expect(await testProcessor.testResolveVariableValue(123, contextManager)).toBe(123)
      expect(await testProcessor.testResolveVariableValue(true, contextManager)).toBe(true)
      expect(
        await testProcessor.testResolveVariableValue({ test: 'value' }, contextManager)
      ).toEqual({
        test: 'value',
      })
    })
  })

  describe('Nested Property Access', () => {
    it('should handle complex nested objects', () => {
      const complexObj = {
        user: {
          profile: { preferences: { theme: 'dark', notifications: { email: true, sms: false } } },
        },
        items: [
          { id: 1, name: 'Item 1' },
          { id: 2, name: 'Item 2' },
        ],
      }

      expect(
        testProcessor.testGetNestedProperty(complexObj, 'user.profile.preferences.theme')
      ).toBe('dark')
      expect(
        testProcessor.testGetNestedProperty(
          complexObj,
          'user.profile.preferences.notifications.email'
        )
      ).toBe(true)
      expect(testProcessor.testGetNestedProperty(complexObj, 'items[0].name')).toBe('Item 1')
      expect(testProcessor.testGetNestedProperty(complexObj, 'items[1].id')).toBe(2)
    })

    it('should handle invalid paths gracefully', () => {
      const obj = { a: { b: 'value' } }

      expect(testProcessor.testGetNestedProperty(obj, 'a.b.c')).toBeUndefined()
      expect(testProcessor.testGetNestedProperty(obj, 'nonexistent')).toBeUndefined()
      expect(testProcessor.testGetNestedProperty(obj, 'a.nonexistent.path')).toBeUndefined()
    })
  })

  describe('Integration Test', () => {
    it('should work end-to-end with all variable types', async () => {
      // Set up complete variable environment
      contextManager.initializeSystemVariables()
      contextManager.initializeEnvironmentVariables([
        { name: 'SUPPORT_EMAIL', value: 'support@company.com', type: 'string' },
        { name: 'MAX_ITEMS', value: 10, type: 'number' },
      ])
      contextManager.initializeSchemaVariables('message', {
        id: 'msg-456',
        subject: 'Support Request',
        from: { email: 'customer@example.com', name: 'John Customer' },
        content: { text: 'I need help with my order' },
      })

      // Test complex template with all variable types
      const complexTemplate = `
        Execution: {{sys.executionId}}
        Support Email: {{env.SUPPORT_EMAIL}}
        Customer: {{message.from.name}} ({{message.from.email}})
        Subject: {{message.subject}}
        Message: {{message.content.text}}
        Max Items: {{env.MAX_ITEMS}}
      `.trim()

      const result = await testProcessor.testResolveVariableValue(complexTemplate, contextManager)

      expect(result).toContain('Execution: exec-1')
      expect(result).toContain('Support Email: support@company.com')
      expect(result).toContain('Customer: John Customer (customer@example.com)')
      expect(result).toContain('Subject: Support Request')
      expect(result).toContain('Message: I need help with my order')
      expect(result).toContain('Max Items: 10')
    })
  })
})
