// packages/lib/src/workflow-engine/nodes/action-nodes/__tests__/ai-v2.test.ts

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { AIProcessorV2 } from '../ai-v2'
import { WorkflowNodeType } from '../../../core/types'
import type { WorkflowNode } from '../../../core/types'

/**
 * Test suite for AIProcessorV2
 *
 * These tests ensure that the AI node correctly:
 * - Extends BaseAiNodeProcessor
 * - Handles prompt templates and legacy prompts
 * - Supports structured output
 * - Manages tools integration
 * - Extracts required variables
 */
describe('AIProcessorV2', () => {
  let processor: AIProcessorV2
  let mockContextManager: any

  beforeEach(() => {
    processor = new AIProcessorV2()

    // Mock ExecutionContextManager
    mockContextManager = {
      getVariable: vi.fn((path: string) => {
        if (path === 'sys.organizationId') return 'org_test_123'
        if (path === 'sys.userId') return 'user_test_123'
        if (path === 'sys.workflow') return { id: 'workflow_123', name: 'Test Workflow' }
        if (path === 'webhook.email') return 'test@example.com'
        if (path === 'webhook.subject') return 'Test Subject'
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
    it('should initialize without node registry', () => {
      const proc = new AIProcessorV2()
      expect(proc).toBeDefined()
      expect(proc.type).toBe(WorkflowNodeType.AI)
    })

    it('should initialize with node registry for tools', () => {
      const mockRegistry = { getNode: vi.fn() }
      const proc = new AIProcessorV2(mockRegistry)
      expect(proc).toBeDefined()
      expect((proc as any).toolRegistry).toBeDefined()
      expect((proc as any).toolExecutionManager).toBeDefined()
    })
  })

  describe('buildMessages - Prompt Template Format', () => {
    it('should build messages from prompt_template array', async () => {
      const node: WorkflowNode = {
        nodeId: 'node_1',
        name: 'AI Node',
        type: WorkflowNodeType.AI,
        position: { x: 0, y: 0 },
        data: {
          model: { provider: 'openai', name: 'gpt-4' },
          prompt_template: [
            { role: 'system', text: 'You are a helpful assistant' },
            { role: 'user', text: 'Hello, world!' },
          ],
        },
      }

      const messages = await (processor as any).buildMessages(
        node,
        node.data,
        mockContextManager
      )

      expect(messages).toHaveLength(2)
      expect(messages[0]).toEqual({ role: 'system', content: 'You are a helpful assistant' })
      expect(messages[1]).toEqual({ role: 'user', content: 'Hello, world!' })
    })

    it('should interpolate variables in prompt templates', async () => {
      const node: WorkflowNode = {
        nodeId: 'node_1',
        name: 'AI Node',
        type: WorkflowNodeType.AI,
        position: { x: 0, y: 0 },
        data: {
          model: { provider: 'openai', name: 'gpt-4' },
          prompt_template: [
            { role: 'system', text: 'You are a helpful assistant' },
            { role: 'user', text: 'Email: {{webhook.email}}, Subject: {{webhook.subject}}' },
          ],
        },
      }

      const messages = await (processor as any).buildMessages(
        node,
        node.data,
        mockContextManager
      )

      expect(messages[1].content).toBe('Email: test@example.com, Subject: Test Subject')
    })
  })

  describe('buildMessages - Legacy Format', () => {
    it('should build messages from legacy prompt field', async () => {
      const node: WorkflowNode = {
        nodeId: 'node_1',
        name: 'AI Node',
        type: WorkflowNodeType.AI,
        position: { x: 0, y: 0 },
        data: {
          model: { provider: 'openai', name: 'gpt-4' },
          prompt: 'Write me a poem',
        },
      }

      const messages = await (processor as any).buildMessages(
        node,
        node.data,
        mockContextManager
      )

      expect(messages).toHaveLength(1)
      expect(messages[0]).toEqual({ role: 'user', content: 'Write me a poem' })
    })

    it('should build messages with systemPrompt in legacy format', async () => {
      const node: WorkflowNode = {
        nodeId: 'node_1',
        name: 'AI Node',
        type: WorkflowNodeType.AI,
        position: { x: 0, y: 0 },
        data: {
          model: { provider: 'openai', name: 'gpt-4' },
          systemPrompt: 'You are a poet',
          prompt: 'Write me a poem',
        },
      }

      const messages = await (processor as any).buildMessages(
        node,
        node.data,
        mockContextManager
      )

      expect(messages).toHaveLength(2)
      expect(messages[0]).toEqual({ role: 'system', content: 'You are a poet' })
      expect(messages[1]).toEqual({ role: 'user', content: 'Write me a poem' })
    })

    it('should throw error if no prompt configuration found', async () => {
      const node: WorkflowNode = {
        nodeId: 'node_1',
        name: 'AI Node',
        type: WorkflowNodeType.AI,
        position: { x: 0, y: 0 },
        data: {
          model: { provider: 'openai', name: 'gpt-4' },
        },
      }

      await expect(
        (processor as any).buildMessages(node, node.data, mockContextManager)
      ).rejects.toThrow('No prompt configuration found')
    })
  })

  describe('getStructuredOutputConfig', () => {
    it('should return undefined when structured output is disabled', () => {
      const node: WorkflowNode = {
        nodeId: 'node_1',
        name: 'AI Node',
        type: WorkflowNodeType.AI,
        position: { x: 0, y: 0 },
        data: {
          structured_output: { enabled: false },
        },
      }

      const config = (processor as any).getStructuredOutputConfig(node, node.data)
      expect(config).toBeUndefined()
    })

    it('should return undefined when structured output is not configured', () => {
      const node: WorkflowNode = {
        nodeId: 'node_1',
        name: 'AI Node',
        type: WorkflowNodeType.AI,
        position: { x: 0, y: 0 },
        data: {},
      }

      const config = (processor as any).getStructuredOutputConfig(node, node.data)
      expect(config).toBeUndefined()
    })

    it('should return structured output config when enabled', () => {
      const schema = {
        type: 'object' as const,
        properties: {
          summary: { type: 'string' },
          sentiment: { type: 'string' },
        },
        required: ['summary', 'sentiment'],
      }

      const node: WorkflowNode = {
        nodeId: 'node_1',
        name: 'AI Node',
        type: WorkflowNodeType.AI,
        position: { x: 0, y: 0 },
        data: {
          structured_output: {
            enabled: true,
            schema,
          },
        },
      }

      const config = (processor as any).getStructuredOutputConfig(node, node.data)
      expect(config).toEqual({
        enabled: true,
        schema,
      })
    })
  })

  describe('getTools', () => {
    it('should return undefined when tools are not enabled', async () => {
      const node: WorkflowNode = {
        nodeId: 'node_1',
        name: 'AI Node',
        type: WorkflowNodeType.AI,
        position: { x: 0, y: 0 },
        data: {
          tools: { enabled: false },
        },
      }

      const tools = await (processor as any).getTools(
        node,
        node.data,
        { id: 'workflow_1' },
        mockContextManager
      )
      expect(tools).toBeUndefined()
    })

    it('should return undefined when tool registry is not initialized', async () => {
      const node: WorkflowNode = {
        nodeId: 'node_1',
        name: 'AI Node',
        type: WorkflowNodeType.AI,
        position: { x: 0, y: 0 },
        data: {
          tools: { enabled: true, mode: 'both' },
        },
      }

      const tools = await (processor as any).getTools(
        node,
        node.data,
        { id: 'workflow_1' },
        mockContextManager
      )
      expect(tools).toBeUndefined()
    })

    it('should return undefined when workflow is not provided', async () => {
      const mockRegistry = { getNode: vi.fn() }
      const proc = new AIProcessorV2(mockRegistry)

      const node: WorkflowNode = {
        nodeId: 'node_1',
        name: 'AI Node',
        type: WorkflowNodeType.AI,
        position: { x: 0, y: 0 },
        data: {
          tools: { enabled: true, mode: 'both' },
        },
      }

      const tools = await (proc as any).getTools(node, node.data, undefined, mockContextManager)
      expect(tools).toBeUndefined()
    })
  })

  describe('getToolExecutor', () => {
    it('should return undefined when tool execution manager is not initialized', async () => {
      const node: WorkflowNode = {
        nodeId: 'node_1',
        name: 'AI Node',
        type: WorkflowNodeType.AI,
        position: { x: 0, y: 0 },
        data: {},
      }

      const executor = await (processor as any).getToolExecutor(
        node,
        node.data,
        { id: 'workflow_1' },
        mockContextManager
      )
      expect(executor).toBeUndefined()
    })

    it('should return undefined when workflow is not provided', async () => {
      const mockRegistry = { getNode: vi.fn() }
      const proc = new AIProcessorV2(mockRegistry)

      const node: WorkflowNode = {
        nodeId: 'node_1',
        name: 'AI Node',
        type: WorkflowNodeType.AI,
        position: { x: 0, y: 0 },
        data: {},
      }

      const executor = await (proc as any).getToolExecutor(
        node,
        node.data,
        undefined,
        mockContextManager
      )
      expect(executor).toBeUndefined()
    })
  })

  describe('extractRequiredVariables', () => {
    it('should extract variables from prompt_template', () => {
      const node: WorkflowNode = {
        nodeId: 'node_1',
        name: 'AI Node',
        type: WorkflowNodeType.AI,
        position: { x: 0, y: 0 },
        data: {
          prompt_template: [
            { role: 'system', text: 'You are a helpful assistant' },
            { role: 'user', text: 'Email: {{webhook.email}}, Name: {{webhook.name}}' },
          ],
        },
      }

      const variables = (processor as any).extractRequiredVariables(node)
      expect(variables).toContain('webhook.email')
      expect(variables).toContain('webhook.name')
    })

    it('should extract variables from legacy prompt', () => {
      const node: WorkflowNode = {
        nodeId: 'node_1',
        name: 'AI Node',
        type: WorkflowNodeType.AI,
        position: { x: 0, y: 0 },
        data: {
          prompt: 'Summarize: {{article.content}}',
        },
      }

      const variables = (processor as any).extractRequiredVariables(node)
      expect(variables).toContain('article.content')
    })

    it('should extract variables from systemPrompt', () => {
      const node: WorkflowNode = {
        nodeId: 'node_1',
        name: 'AI Node',
        type: WorkflowNodeType.AI,
        position: { x: 0, y: 0 },
        data: {
          systemPrompt: 'Context: {{sys.context}}',
          prompt: 'Question: {{user.question}}',
        },
      }

      const variables = (processor as any).extractRequiredVariables(node)
      expect(variables).toContain('sys.context')
      expect(variables).toContain('user.question')
    })

    it('should extract variables from context selector', () => {
      const node: WorkflowNode = {
        nodeId: 'node_1',
        name: 'AI Node',
        type: WorkflowNodeType.AI,
        position: { x: 0, y: 0 },
        data: {
          prompt_template: [{ role: 'user', text: 'Hello' }],
          context: {
            enabled: true,
            variable_selector: ['workflow.state', 'user.preferences'],
          },
        },
      }

      const variables = (processor as any).extractRequiredVariables(node)
      expect(variables).toContain('workflow.state')
      expect(variables).toContain('user.preferences')
    })

    it('should return unique variables only', () => {
      const node: WorkflowNode = {
        nodeId: 'node_1',
        name: 'AI Node',
        type: WorkflowNodeType.AI,
        position: { x: 0, y: 0 },
        data: {
          prompt_template: [
            { role: 'system', text: 'Email: {{webhook.email}}' },
            { role: 'user', text: 'Also email: {{webhook.email}}' },
          ],
        },
      }

      const variables = (processor as any).extractRequiredVariables(node)
      // Should only contain webhook.email once
      const emailCount = variables.filter((v: string) => v === 'webhook.email').length
      expect(emailCount).toBe(1)
    })
  })

  describe('validateNodeConfig', () => {
    it('should validate prompt_template configuration', async () => {
      const node: WorkflowNode = {
        nodeId: 'node_1',
        name: 'AI Node',
        type: WorkflowNodeType.AI,
        position: { x: 0, y: 0 },
        data: {
          model: { provider: 'openai', name: 'gpt-4' },
          prompt_template: [{ role: 'user', text: 'Hello' }],
        },
      }

      const result = await (processor as any).validateNodeConfig(node)
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should validate legacy prompt configuration', async () => {
      const node: WorkflowNode = {
        nodeId: 'node_1',
        name: 'AI Node',
        type: WorkflowNodeType.AI,
        position: { x: 0, y: 0 },
        data: {
          model: { provider: 'openai', name: 'gpt-4' },
          prompt: 'Hello world',
        },
      }

      const result = await (processor as any).validateNodeConfig(node)
      expect(result.valid).toBe(true)
    })

    it('should fail validation without prompt', async () => {
      const node: WorkflowNode = {
        nodeId: 'node_1',
        name: 'AI Node',
        type: WorkflowNodeType.AI,
        position: { x: 0, y: 0 },
        data: {
          model: { provider: 'openai', name: 'gpt-4' },
        },
      }

      const result = await (processor as any).validateNodeConfig(node)
      expect(result.valid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
    })

    it('should validate temperature range', async () => {
      const node: WorkflowNode = {
        nodeId: 'node_1',
        name: 'AI Node',
        type: WorkflowNodeType.AI,
        position: { x: 0, y: 0 },
        data: {
          model: {
            provider: 'openai',
            name: 'gpt-4',
            completion_params: { temperature: 3.0 },
          },
          prompt: 'Hello',
        },
      }

      const result = await (processor as any).validateNodeConfig(node)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Temperature must be a number between 0 and 2')
    })

    it('should validate max_tokens is positive', async () => {
      const node: WorkflowNode = {
        nodeId: 'node_1',
        name: 'AI Node',
        type: WorkflowNodeType.AI,
        position: { x: 0, y: 0 },
        data: {
          model: {
            provider: 'openai',
            name: 'gpt-4',
            completion_params: { max_tokens: -100 },
          },
          prompt: 'Hello',
        },
      }

      const result = await (processor as any).validateNodeConfig(node)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Max tokens must be a positive number')
    })

    it('should validate structured output schema', async () => {
      const node: WorkflowNode = {
        nodeId: 'node_1',
        name: 'AI Node',
        type: WorkflowNodeType.AI,
        position: { x: 0, y: 0 },
        data: {
          model: { provider: 'openai', name: 'gpt-4' },
          prompt: 'Hello',
          structured_output: {
            enabled: true,
            // Missing schema
          },
        },
      }

      const result = await (processor as any).validateNodeConfig(node)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Structured output is enabled but no schema is defined')
    })

    it('should validate tools configuration mode', async () => {
      const node: WorkflowNode = {
        nodeId: 'node_1',
        name: 'AI Node',
        type: WorkflowNodeType.AI,
        position: { x: 0, y: 0 },
        data: {
          model: { provider: 'openai', name: 'gpt-4' },
          prompt: 'Hello',
          tools: {
            enabled: true,
            mode: 'invalid_mode' as any,
          },
        },
      }

      const result = await (processor as any).validateNodeConfig(node)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain(
        'Tools mode must be one of: workflow_nodes, built_in, both'
      )
    })
  })
})
