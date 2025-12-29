// packages/lib/src/workflow-engine/nodes/transform-nodes/__tests__/text-classifier.test.ts

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { TextClassifierProcessor } from '../text-classifier'
import { WorkflowNodeType } from '../../../core/types'
import type { WorkflowNode } from '../../../core/types'

/**
 * Test suite for TextClassifierProcessor
 *
 * These tests ensure that the text classifier:
 * - Extends BaseAiNodeProcessor
 * - Builds classification prompts correctly
 * - Handles classification responses
 * - Routes to correct output handles based on category
 * - Validates configuration properly
 */
describe('TextClassifierProcessor', () => {
  let processor: TextClassifierProcessor
  let mockContextManager: any

  beforeEach(() => {
    processor = new TextClassifierProcessor()

    // Mock ExecutionContextManager
    mockContextManager = {
      getVariable: vi.fn((path: string) => {
        if (path === 'sys.organizationId') return 'org_test_123'
        if (path === 'sys.userId') return 'user_test_123'
        if (path === 'sys.workflow') return { id: 'workflow_123', name: 'Test Workflow' }
        if (path === 'ticket.subject') return 'Billing question'
        if (path === 'ticket.body') return 'I need help with my invoice'
        return undefined
      }),
      setVariable: vi.fn(),
      setNodeVariable: vi.fn(),
      log: vi.fn(),
      getContext: vi.fn(() => ({
        organizationId: 'org_test_123',
        userId: 'user_test_123',
      })),
      getAllVariables: vi.fn(() => ({})),
      buildOptimizedContext: vi.fn(() => new Map()),
    }
  })

  describe('Initialization', () => {
    it('should initialize and extend BaseAiNodeProcessor', () => {
      expect(processor).toBeDefined()
      expect(processor.type).toBe(WorkflowNodeType.TEXT_CLASSIFIER)
      expect((processor as any).llmOrchestrator).toBeDefined()
      expect((processor as any).usageService).toBeDefined()
    })
  })

  describe('buildMessages', () => {
    it('should build classification messages with system and user prompts', async () => {
      const node: WorkflowNode = {
        nodeId: 'node_1',
        name: 'Classifier',
        type: WorkflowNodeType.TEXT_CLASSIFIER,
        position: { x: 0, y: 0 },
        data: {
          model: { provider: 'openai', name: 'gpt-4o-mini' },
          text: 'Classify this text',
          categories: [
            { name: 'urgent', description: 'Urgent matters' },
            { name: 'normal', description: 'Normal matters' },
          ],
        },
      }

      const messages = await (processor as any).buildMessages(
        node,
        node.data,
        mockContextManager
      )

      expect(messages).toHaveLength(2)
      expect(messages[0].role).toBe('system')
      expect(messages[0].content).toContain('classify')
      expect(messages[1].role).toBe('user')
      expect(messages[1].content).toContain('Classify this text')
    })

    it('should include custom instructions in system prompt', async () => {
      const node: WorkflowNode = {
        nodeId: 'node_1',
        name: 'Classifier',
        type: WorkflowNodeType.TEXT_CLASSIFIER,
        position: { x: 0, y: 0 },
        data: {
          model: { provider: 'openai', name: 'gpt-4o-mini' },
          text: 'Test text',
          categories: [{ name: 'category1', description: 'Description 1' }],
          instruction: {
            enabled: true,
            text: 'Focus on sentiment analysis',
          },
        },
      }

      const messages = await (processor as any).buildMessages(
        node,
        node.data,
        mockContextManager
      )

      expect(messages[0].content).toContain('Focus on sentiment analysis')
    })

    it('should interpolate variables in text', async () => {
      const node: WorkflowNode = {
        nodeId: 'node_1',
        name: 'Classifier',
        type: WorkflowNodeType.TEXT_CLASSIFIER,
        position: { x: 0, y: 0 },
        data: {
          model: { provider: 'openai', name: 'gpt-4o-mini' },
          text: 'Subject: {{ticket.subject}}, Body: {{ticket.body}}',
          categories: [{ name: 'billing', description: 'Billing related' }],
        },
      }

      const messages = await (processor as any).buildMessages(
        node,
        node.data,
        mockContextManager
      )

      expect(messages[1].content).toContain('Subject: Billing question')
      expect(messages[1].content).toContain('Body: I need help with my invoice')
    })

    it('should interpolate variables in category descriptions', async () => {
      const node: WorkflowNode = {
        nodeId: 'node_1',
        name: 'Classifier',
        type: WorkflowNodeType.TEXT_CLASSIFIER,
        position: { x: 0, y: 0 },
        data: {
          model: { provider: 'openai', name: 'gpt-4o-mini' },
          text: 'Test',
          categories: [
            {
              name: 'billing',
              description: 'Questions about {{ticket.subject}}',
            },
          ],
        },
      }

      const messages = await (processor as any).buildMessages(
        node,
        node.data,
        mockContextManager
      )

      expect(messages[1].content).toContain('Questions about Billing question')
    })
  })

  describe('getStructuredOutputConfig', () => {
    it('should always return structured output config for classification', () => {
      const node: WorkflowNode = {
        nodeId: 'node_1',
        name: 'Classifier',
        type: WorkflowNodeType.TEXT_CLASSIFIER,
        position: { x: 0, y: 0 },
        data: {},
      }

      const config = (processor as any).getStructuredOutputConfig(node, node.data)

      expect(config).toBeDefined()
      expect(config.enabled).toBe(true)
      expect(config.schema.type).toBe('object')
      expect(config.schema.properties).toHaveProperty('category')
      expect(config.schema.properties).toHaveProperty('confidence')
      expect(config.schema.properties).toHaveProperty('reasoning')
      expect(config.schema.required).toContain('category')
      expect(config.schema.required).toContain('confidence')
      expect(config.schema.required).toContain('reasoning')
    })
  })

  describe('getDefaultTemperature', () => {
    it('should return 0.3 for consistent classification', () => {
      const temp = (processor as any).getDefaultTemperature()
      expect(temp).toBe(0.3)
    })
  })

  describe('extractRequiredVariables', () => {
    it('should extract variables from text field', () => {
      const node: WorkflowNode = {
        nodeId: 'node_1',
        name: 'Classifier',
        type: WorkflowNodeType.TEXT_CLASSIFIER,
        position: { x: 0, y: 0 },
        data: {
          text: 'Email: {{webhook.email}}, Subject: {{webhook.subject}}',
          categories: [],
        },
      }

      const variables = (processor as any).extractRequiredVariables(node)
      expect(variables).toContain('webhook.email')
      expect(variables).toContain('webhook.subject')
    })

    it('should extract variables from instruction field', () => {
      const node: WorkflowNode = {
        nodeId: 'node_1',
        name: 'Classifier',
        type: WorkflowNodeType.TEXT_CLASSIFIER,
        position: { x: 0, y: 0 },
        data: {
          text: 'Test',
          instruction: {
            enabled: true,
            text: 'Consider context: {{sys.context}}',
          },
          categories: [],
        },
      }

      const variables = (processor as any).extractRequiredVariables(node)
      expect(variables).toContain('sys.context')
    })

    it('should extract variables from category descriptions', () => {
      const node: WorkflowNode = {
        nodeId: 'node_1',
        name: 'Classifier',
        type: WorkflowNodeType.TEXT_CLASSIFIER,
        position: { x: 0, y: 0 },
        data: {
          text: 'Test',
          categories: [
            { name: 'cat1', description: 'Related to {{product.name}}' },
            { name: 'cat2', description: 'About {{service.type}}' },
          ],
        },
      }

      const variables = (processor as any).extractRequiredVariables(node)
      expect(variables).toContain('product.name')
      expect(variables).toContain('service.type')
    })

    it('should return unique variables only', () => {
      const node: WorkflowNode = {
        nodeId: 'node_1',
        name: 'Classifier',
        type: WorkflowNodeType.TEXT_CLASSIFIER,
        position: { x: 0, y: 0 },
        data: {
          text: '{{webhook.email}}',
          instruction: {
            enabled: true,
            text: 'Check {{webhook.email}}',
          },
          categories: [],
        },
      }

      const variables = (processor as any).extractRequiredVariables(node)
      const emailCount = variables.filter((v: string) => v === 'webhook.email').length
      expect(emailCount).toBe(1)
    })
  })

  describe('validateNodeConfig', () => {
    it('should validate complete configuration', async () => {
      const node: WorkflowNode = {
        nodeId: 'node_1',
        name: 'Classifier',
        type: WorkflowNodeType.TEXT_CLASSIFIER,
        position: { x: 0, y: 0 },
        connections: {
          branches: {
            urgent: [{ targetNodeId: 'node_2', targetHandle: 'input' }],
          },
        },
        data: {
          model: { provider: 'openai', name: 'gpt-4o-mini' },
          text: 'Classify this',
          categories: [
            { name: 'urgent', description: 'Urgent matters' },
            { name: 'normal', description: 'Normal matters' },
          ],
        },
      }

      const result = await (processor as any).validateNodeConfig(node)
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should require model provider', async () => {
      const node: WorkflowNode = {
        nodeId: 'node_1',
        name: 'Classifier',
        type: WorkflowNodeType.TEXT_CLASSIFIER,
        position: { x: 0, y: 0 },
        data: {
          model: { name: 'gpt-4' },
          text: 'Test',
          categories: [{ name: 'cat1', description: 'Desc' }],
        },
      }

      const result = await (processor as any).validateNodeConfig(node)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Model provider is required')
    })

    it('should require model name', async () => {
      const node: WorkflowNode = {
        nodeId: 'node_1',
        name: 'Classifier',
        type: WorkflowNodeType.TEXT_CLASSIFIER,
        position: { x: 0, y: 0 },
        data: {
          model: { provider: 'openai' },
          text: 'Test',
          categories: [{ name: 'cat1', description: 'Desc' }],
        },
      }

      const result = await (processor as any).validateNodeConfig(node)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Model name is required')
    })

    it('should require text to classify', async () => {
      const node: WorkflowNode = {
        nodeId: 'node_1',
        name: 'Classifier',
        type: WorkflowNodeType.TEXT_CLASSIFIER,
        position: { x: 0, y: 0 },
        data: {
          model: { provider: 'openai', name: 'gpt-4' },
          text: '   ',
          categories: [{ name: 'cat1', description: 'Desc' }],
        },
      }

      const result = await (processor as any).validateNodeConfig(node)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Text to classify is required')
    })

    it('should require at least one category', async () => {
      const node: WorkflowNode = {
        nodeId: 'node_1',
        name: 'Classifier',
        type: WorkflowNodeType.TEXT_CLASSIFIER,
        position: { x: 0, y: 0 },
        data: {
          model: { provider: 'openai', name: 'gpt-4' },
          text: 'Test',
          categories: [],
        },
      }

      const result = await (processor as any).validateNodeConfig(node)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('At least one category is required')
    })

    it('should require category names', async () => {
      const node: WorkflowNode = {
        nodeId: 'node_1',
        name: 'Classifier',
        type: WorkflowNodeType.TEXT_CLASSIFIER,
        position: { x: 0, y: 0 },
        data: {
          model: { provider: 'openai', name: 'gpt-4' },
          text: 'Test',
          categories: [{ name: '', description: 'Empty name' }],
        },
      }

      const result = await (processor as any).validateNodeConfig(node)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Category 1: Name is required')
    })

    it('should validate temperature range', async () => {
      const node: WorkflowNode = {
        nodeId: 'node_1',
        name: 'Classifier',
        type: WorkflowNodeType.TEXT_CLASSIFIER,
        position: { x: 0, y: 0 },
        data: {
          model: {
            provider: 'openai',
            name: 'gpt-4',
            completion_params: { temperature: 5.0 },
          },
          text: 'Test',
          categories: [{ name: 'cat1', description: 'Desc' }],
        },
      }

      const result = await (processor as any).validateNodeConfig(node)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Temperature must be a number between 0 and 2')
    })

    it('should warn about many categories', async () => {
      const categories = Array.from({ length: 25 }, (_, i) => ({
        name: `cat${i}`,
        description: `Category ${i}`,
      }))

      const node: WorkflowNode = {
        nodeId: 'node_1',
        name: 'Classifier',
        type: WorkflowNodeType.TEXT_CLASSIFIER,
        position: { x: 0, y: 0 },
        data: {
          model: { provider: 'openai', name: 'gpt-4' },
          text: 'Test',
          categories,
        },
      }

      const result = await (processor as any).validateNodeConfig(node)
      expect(result.warnings).toContain(
        'Having more than 20 categories may reduce classification accuracy'
      )
    })

    it('should warn about missing category connections', async () => {
      const node: WorkflowNode = {
        nodeId: 'node_1',
        name: 'Classifier',
        type: WorkflowNodeType.TEXT_CLASSIFIER,
        position: { x: 0, y: 0 },
        connections: {
          branches: {},
        },
        data: {
          model: { provider: 'openai', name: 'gpt-4' },
          text: 'Test',
          categories: [{ name: 'cat1', description: 'Desc' }],
        },
      }

      const result = await (processor as any).validateNodeConfig(node)
      expect(result.warnings).toContain(
        'No category connections defined. All flows will use the default connection.'
      )
    })
  })
})
