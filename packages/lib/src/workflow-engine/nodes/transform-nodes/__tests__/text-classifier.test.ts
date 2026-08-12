// packages/lib/src/workflow-engine/nodes/transform-nodes/__tests__/text-classifier.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NodeData, WorkflowNode } from '../../../core/types'
import { WorkflowNodeType } from '../../../core/types'
import { TextClassifierProcessor } from '../text-classifier'

/**
 * Builds a classifier node in the shape `WorkflowGraphBuilder.transformNodes`
 * emits: `id`/`nodeId` mirror the canvas node id, position sits in metadata.
 */
const classifierNode = (data: Partial<NodeData>): WorkflowNode => ({
  id: 'node_1',
  workflowId: 'workflow_1',
  nodeId: 'node_1',
  name: 'Classifier',
  type: WorkflowNodeType.TEXT_CLASSIFIER,
  data: {
    id: 'node_1',
    type: WorkflowNodeType.TEXT_CLASSIFIER,
    title: 'Classifier',
    ...data,
  },
  metadata: { position: { x: 0, y: 0 } },
})

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
      interpolateVariables: vi.fn().mockImplementation((text: string) => {
        return Promise.resolve(
          text.replace(/\{\{([^}]+)\}\}/g, (_, path: string) => {
            if (path === 'ticket.subject') return 'Billing question'
            if (path === 'ticket.body') return 'I need help with my invoice'
            if (path === 'sys.context') return 'test-context'
            if (path === 'product.name') return 'Test Product'
            if (path === 'service.type') return 'Test Service'
            if (path === 'webhook.email') return 'test@example.com'
            if (path === 'webhook.subject') return 'Test Subject'
            return ''
          })
        )
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
      const node = classifierNode({
        model: { provider: 'openai', name: 'gpt-4o-mini' },
        text: 'Classify this text',
        categories: [
          { name: 'urgent', description: 'Urgent matters' },
          { name: 'normal', description: 'Normal matters' },
        ],
      })

      const messages = await (processor as any).buildMessages(node, node.data, mockContextManager)

      expect(messages).toHaveLength(2)
      expect(messages[0].role).toBe('system')
      expect(messages[0].content).toContain('classify')
      expect(messages[1].role).toBe('user')
      expect(messages[1].content).toContain('Classify this text')
    })

    it('should include custom instructions in system prompt', async () => {
      const node = classifierNode({
        model: { provider: 'openai', name: 'gpt-4o-mini' },
        text: 'Test text',
        categories: [{ name: 'category1', description: 'Description 1' }],
        instruction: {
          enabled: true,
          text: 'Focus on sentiment analysis',
        },
      })

      const messages = await (processor as any).buildMessages(node, node.data, mockContextManager)

      expect(messages[0].content).toContain('Focus on sentiment analysis')
    })

    it('should interpolate variables in text', async () => {
      const node = classifierNode({
        model: { provider: 'openai', name: 'gpt-4o-mini' },
        text: 'Subject: {{ticket.subject}}, Body: {{ticket.body}}',
        categories: [{ name: 'billing', description: 'Billing related' }],
      })

      const messages = await (processor as any).buildMessages(node, node.data, mockContextManager)

      expect(messages[1].content).toContain('Subject: Billing question')
      expect(messages[1].content).toContain('Body: I need help with my invoice')
    })

    it('should interpolate variables in category descriptions', async () => {
      const node = classifierNode({
        model: { provider: 'openai', name: 'gpt-4o-mini' },
        text: 'Test',
        categories: [
          {
            name: 'billing',
            description: 'Questions about {{ticket.subject}}',
          },
        ],
      })

      const messages = await (processor as any).buildMessages(node, node.data, mockContextManager)

      expect(messages[1].content).toContain('Questions about Billing question')
    })
  })

  describe('handleResponse — the published output contract', () => {
    /**
     * The classifier advertises exactly three paths in the builder
     * (`getTextClassifierOutputVariables`, `text-classifier/schema.ts`) and the
     * bundled `order-issue-triage` template reads `{{classifier-013.category}}`
     * off the fixed name. These are the assertions that make the legacy
     * `data.outputVariable` alias redundant rather than missing, so they are
     * what stops a future change from quietly re-opening the gap.
     */
    const categories = [
      { id: 'cat_urgent', name: 'urgent', description: 'Urgent matters' },
      { id: 'cat_normal', name: 'normal', description: 'Normal matters' },
    ]

    const classifiedResponse = (category: string) => ({
      content: JSON.stringify({ category, confidence: 0.91, reasoning: 'because' }),
      model: 'gpt-4o-mini',
      provider: 'openai',
    })

    it('publishes category / confidence / reasoning under the fixed node paths', async () => {
      const node = classifierNode({ categories })

      await (processor as any).handleResponse(
        node,
        node.data,
        mockContextManager,
        classifiedResponse('urgent')
      )

      expect(mockContextManager.setNodeVariable).toHaveBeenCalledWith(
        'node_1',
        'category',
        'urgent'
      )
      expect(mockContextManager.setNodeVariable).toHaveBeenCalledWith('node_1', 'confidence', 0.91)
      expect(mockContextManager.setNodeVariable).toHaveBeenCalledWith(
        'node_1',
        'reasoning',
        'because'
      )
    })

    it('publishes nothing beyond those three paths, and no free-form alias', async () => {
      const node = classifierNode({ categories })

      await (processor as any).handleResponse(
        node,
        // A stray `outputVariable` is the legacy alias shape. The classifier
        // must ignore it outright — the fixed names above are the contract.
        { ...node.data, outputVariable: 'my.custom.alias' },
        mockContextManager,
        classifiedResponse('urgent')
      )

      const publishedPaths = mockContextManager.setNodeVariable.mock.calls.map(
        (call: unknown[]) => call[1]
      )
      expect(publishedPaths.sort()).toEqual(['category', 'confidence', 'reasoning'])
      expect(mockContextManager.setVariable).not.toHaveBeenCalled()
    })

    it('routes to the matched category handle in branches mode', async () => {
      const node = classifierNode({ categories, outputMode: 'branches' })

      const result = await (processor as any).handleResponse(
        node,
        node.data,
        mockContextManager,
        classifiedResponse('normal')
      )

      expect(result.outputHandle).toBe('cat_normal')
      expect(result.output).toEqual({
        category: 'normal',
        confidence: 0.91,
        reasoning: 'because',
      })
    })

    it("routes to the single 'source' handle in variable mode", async () => {
      const node = classifierNode({ categories, outputMode: 'variable' })

      const result = await (processor as any).handleResponse(
        node,
        node.data,
        mockContextManager,
        classifiedResponse('normal')
      )

      // Variable mode is a ROUTING choice, not an aliasing one: the panel's own
      // help text points the user at the `category` output variable.
      expect(result.outputHandle).toBe('source')
      expect(mockContextManager.setNodeVariable).toHaveBeenCalledWith(
        'node_1',
        'category',
        'normal'
      )
    })
  })

  describe('getStructuredOutputConfig', () => {
    it('should always return structured output config for classification', () => {
      const node = classifierNode({})

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
      const node = classifierNode({
        text: 'Email: {{webhook.email}}, Subject: {{webhook.subject}}',
        categories: [],
      })

      const variables = (processor as any).extractRequiredVariables(node)
      expect(variables).toContain('webhook.email')
      expect(variables).toContain('webhook.subject')
    })

    it('should extract variables from instruction field', () => {
      const node = classifierNode({
        text: 'Test',
        instruction: {
          enabled: true,
          text: 'Consider context: {{sys.context}}',
        },
        categories: [],
      })

      const variables = (processor as any).extractRequiredVariables(node)
      expect(variables).toContain('sys.context')
    })

    it('should extract variables from category descriptions', () => {
      const node = classifierNode({
        text: 'Test',
        categories: [
          { name: 'cat1', description: 'Related to {{product.name}}' },
          { name: 'cat2', description: 'About {{service.type}}' },
        ],
      })

      const variables = (processor as any).extractRequiredVariables(node)
      expect(variables).toContain('product.name')
      expect(variables).toContain('service.type')
    })

    it('should return unique variables only', () => {
      const node = classifierNode({
        text: '{{webhook.email}}',
        instruction: {
          enabled: true,
          text: 'Check {{webhook.email}}',
        },
        categories: [],
      })

      const variables = (processor as any).extractRequiredVariables(node)
      const emailCount = variables.filter((v: string) => v === 'webhook.email').length
      expect(emailCount).toBe(1)
    })
  })

  describe('validateNodeConfig', () => {
    it('should validate complete configuration', async () => {
      // `node.connections` was dropped from this fixture: the workflow routes on
      // edges now, and `validateNodeConfig` stopped reading connections with it.
      const node = classifierNode({
        model: { provider: 'openai', name: 'gpt-4o-mini' },
        text: 'Classify this',
        categories: [
          { name: 'urgent', description: 'Urgent matters' },
          { name: 'normal', description: 'Normal matters' },
        ],
      })

      const result = await (processor as any).validateNodeConfig(node)
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should require model provider', async () => {
      const node = classifierNode({
        model: { name: 'gpt-4' },
        text: 'Test',
        categories: [{ name: 'cat1', description: 'Desc' }],
      })

      const result = await (processor as any).validateNodeConfig(node)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Model provider is required')
    })

    it('should require model name', async () => {
      const node = classifierNode({
        model: { provider: 'openai' },
        text: 'Test',
        categories: [{ name: 'cat1', description: 'Desc' }],
      })

      const result = await (processor as any).validateNodeConfig(node)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Model name is required')
    })

    it('should require text to classify', async () => {
      const node = classifierNode({
        model: { provider: 'openai', name: 'gpt-4' },
        text: '   ',
        categories: [{ name: 'cat1', description: 'Desc' }],
      })

      const result = await (processor as any).validateNodeConfig(node)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Text to classify is required')
    })

    it('should require at least one category', async () => {
      const node = classifierNode({
        model: { provider: 'openai', name: 'gpt-4' },
        text: 'Test',
        categories: [],
      })

      const result = await (processor as any).validateNodeConfig(node)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('At least one category is required')
    })

    it('should require category names', async () => {
      const node = classifierNode({
        model: { provider: 'openai', name: 'gpt-4' },
        text: 'Test',
        categories: [{ name: '', description: 'Empty name' }],
      })

      const result = await (processor as any).validateNodeConfig(node)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Category 1: Name is required')
    })

    it('should validate temperature range', async () => {
      const node = classifierNode({
        model: {
          provider: 'openai',
          name: 'gpt-4',
          completion_params: { temperature: 5.0 },
        },
        text: 'Test',
        categories: [{ name: 'cat1', description: 'Desc' }],
      })

      const result = await (processor as any).validateNodeConfig(node)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Temperature must be a number between 0 and 2')
    })

    it('should warn about many categories', async () => {
      const categories = Array.from({ length: 25 }, (_, i) => ({
        name: `cat${i}`,
        description: `Category ${i}`,
      }))

      const node = classifierNode({
        model: { provider: 'openai', name: 'gpt-4' },
        text: 'Test',
        categories,
      })

      const result = await (processor as any).validateNodeConfig(node)
      expect(result.warnings).toContain(
        'Having more than 20 categories may reduce classification accuracy'
      )
    })

    // Note: "missing category connections" test removed - connection validation
    // was removed from validateNodeConfig (workflow uses edges, not node.connections)
  })
})
