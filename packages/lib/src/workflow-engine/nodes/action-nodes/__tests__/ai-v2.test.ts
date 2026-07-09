// packages/lib/src/workflow-engine/nodes/action-nodes/__tests__/ai-v2.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { textToDoc } from '../../../../tiptap'
import type { WorkflowNode } from '../../../core/types'
import { WorkflowNodeType } from '../../../core/types'
import { AIProcessorV2 } from '../ai-v2'

// Phase 5: `buildMessages` lazy-imports `../../../agents` to fetch the org
// tool/toolset catalogs for the reference resolver. Stub the barrel so the
// unit tests don't need DB/cache wiring.
vi.mock('../../../../agents', () => ({
  getOrgToolCatalog: vi.fn(async () => []),
  getOrgToolsetCatalog: vi.fn(async () => []),
  filterToolsByToolsets: vi.fn(() => []),
}))

// Helper: build a Phase-4 `{ role, json }` prompt template from legacy
// `text` so the suite stays readable. Parses `{{var}}` placeholders into
// chips so `extractRequiredVariables` round-trips through `docToText`.
const pt = (role: 'system' | 'user' | 'assistant', text: string) => ({
  role,
  json: textToDoc(text, { parseVariables: true }),
})

/**
 * Tests for the post-Phase-2 AIProcessorV2.
 *
 * The processor now reads the flat `nodeData` shape (`toolsEnabled`,
 * `toolsets`, `appAccounts`) and delegates tool execution to the agent
 * framework via `runWorkflowAiTurn`. The no-tools branch still runs through
 * `BaseAiNodeProcessor.executeNode`.
 *
 * End-to-end coverage (live LLM call, real workflow context manager) is left
 * to integration suites — see plan §6 tests 2–5. Mocking the LLM at this
 * level would replicate the LLM adapter without exercising the bridge.
 */
describe('AIProcessorV2', () => {
  let processor: AIProcessorV2
  let mockContextManager: any

  beforeEach(() => {
    processor = new AIProcessorV2()

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
      buildOptimizedContext: vi.fn(async (ids: string[]) => {
        const map = new Map<string, unknown>()
        for (const id of ids) {
          const value = await mockContextManager.getVariable(id)
          if (value !== undefined) map.set(id, value)
        }
        return map
      }),
      formatForDisplay: vi.fn((value: unknown) => {
        if (value == null) return ''
        if (typeof value !== 'object') return String(value)
        return JSON.stringify(value)
      }),
      interpolateVariables: vi.fn().mockImplementation((text: string) => {
        if (!text || typeof text !== 'string') return Promise.resolve(text)
        const result = text.replace(/\{\{([^}]+)\}\}/g, (_match: string, path: string) => {
          const value = mockContextManager.getVariable(path.trim())
          if (value === undefined || value === null) return _match
          return typeof value === 'object' ? JSON.stringify(value) : String(value)
        })
        return Promise.resolve(result)
      }),
    }
  })

  describe('Initialization', () => {
    it('should initialize without node registry', () => {
      const proc = new AIProcessorV2()
      expect(proc).toBeDefined()
      expect(proc.type).toBe(WorkflowNodeType.AI)
    })

    it('should initialize with a node registry argument (ignored post-Phase-2)', () => {
      const mockRegistry = { getNode: vi.fn() }
      const proc = new AIProcessorV2(mockRegistry)
      expect(proc).toBeDefined()
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
            pt('system', 'You are a helpful assistant'),
            pt('user', 'Hello, world!'),
          ],
        },
      }

      const messages = await (processor as any).buildMessages(node, node.data, mockContextManager)

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
            pt('system', 'You are a helpful assistant'),
            pt('user', 'Email: {{webhook.email}}, Subject: {{webhook.subject}}'),
          ],
        },
      }

      const messages = await (processor as any).buildMessages(node, node.data, mockContextManager)

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

      const messages = await (processor as any).buildMessages(node, node.data, mockContextManager)

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

      const messages = await (processor as any).buildMessages(node, node.data, mockContextManager)

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

  describe('extractRequiredVariables', () => {
    it('should extract variables from prompt_template', () => {
      const node: WorkflowNode = {
        nodeId: 'node_1',
        name: 'AI Node',
        type: WorkflowNodeType.AI,
        position: { x: 0, y: 0 },
        data: {
          prompt_template: [
            pt('system', 'You are a helpful assistant'),
            pt('user', 'Email: {{webhook.email}}, Name: {{webhook.name}}'),
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

    it('ignores legacy context config (dead setting removed)', () => {
      const node: WorkflowNode = {
        nodeId: 'node_1',
        name: 'AI Node',
        type: WorkflowNodeType.AI,
        position: { x: 0, y: 0 },
        data: {
          prompt_template: [pt('user', 'Hello')],
          context: {
            enabled: true,
            variable_selector: ['workflow.state', 'user.preferences'],
          },
        },
      }

      const variables = (processor as any).extractRequiredVariables(node)
      expect(variables).not.toContain('workflow.state')
      expect(variables).not.toContain('user.preferences')
    })

    it('should return unique variables only', () => {
      const node: WorkflowNode = {
        nodeId: 'node_1',
        name: 'AI Node',
        type: WorkflowNodeType.AI,
        position: { x: 0, y: 0 },
        data: {
          prompt_template: [
            pt('system', 'Email: {{webhook.email}}'),
            pt('user', 'Also email: {{webhook.email}}'),
          ],
        },
      }

      const variables = (processor as any).extractRequiredVariables(node)
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
          prompt_template: [pt('user', 'Hello')],
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

    it('should accept toolsEnabled with toolsets array', async () => {
      const node: WorkflowNode = {
        nodeId: 'node_1',
        name: 'AI Node',
        type: WorkflowNodeType.AI,
        position: { x: 0, y: 0 },
        data: {
          model: { provider: 'openai', name: 'gpt-4' },
          prompt: 'Hello',
          toolsEnabled: true,
          toolsets: [{ slug: 'workflow.variable', enabled: true, source: 'manual' }],
        },
      }

      const result = await (processor as any).validateNodeConfig(node)
      expect(result.valid).toBe(true)
    })

    it('should reject invalid maxIterations on a tools-enabled node', async () => {
      const node: WorkflowNode = {
        nodeId: 'node_1',
        name: 'AI Node',
        type: WorkflowNodeType.AI,
        position: { x: 0, y: 0 },
        data: {
          model: { provider: 'openai', name: 'gpt-4' },
          prompt: 'Hello',
          toolsEnabled: true,
          toolsets: [],
          maxIterations: 0,
        },
      }

      const result = await (processor as any).validateNodeConfig(node)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Max iterations must be a positive number')
    })
  })

  describe('buildResolvedAgentShim', () => {
    it('returns undefined when no toolsets are enabled', () => {
      const shim = (processor as any).buildResolvedAgentShim({ toolsets: [] })
      expect(shim).toBeUndefined()
    })

    it('builds a ResolvedAgentConfig-shaped value with enabledTools as a Set (null when absent)', () => {
      const shim = (processor as any).buildResolvedAgentShim({
        toolsets: [
          {
            slug: 'workflow.variable',
            enabled: true,
            source: 'manual',
            config: { enabledTools: ['assign_variable'] },
          },
          { slug: 'auxx:mail:threads', enabled: true, source: 'manual' },
          { slug: 'mail.compose', enabled: false, source: 'manual' },
        ],
        appAccounts: { mailgun: { credId: 'cred_1' } },
      })

      expect(shim.toolsets).toHaveLength(2)
      expect(shim.toolsets[0]).toMatchObject({ slug: 'workflow.variable' })
      expect(shim.toolsets[0].enabledTools.has('assign_variable')).toBe(true)
      expect(shim.toolsets[1]).toMatchObject({ slug: 'auxx:mail:threads', enabledTools: null })
      expect(shim.appAccounts).toEqual({ mailgun: { credId: 'cred_1' } })
    })
  })

  describe('executeNode routing (no-tools path)', () => {
    it('delegates to BaseAiNodeProcessor.executeNode when toolsEnabled is falsy', async () => {
      const proc = new AIProcessorV2()
      const baseSpy = vi
        .spyOn(Object.getPrototypeOf(Object.getPrototypeOf(proc)), 'executeNode')
        .mockResolvedValue({
          status: 0, // NodeRunningStatus.Succeeded numeric is implementation detail
          output: { text: 'no-tools-path' },
          outputHandle: 'source',
        } as any)

      const node: WorkflowNode = {
        nodeId: 'node_1',
        name: 'AI Node',
        type: WorkflowNodeType.AI,
        position: { x: 0, y: 0 },
        data: {
          model: { provider: 'openai', name: 'gpt-4' },
          prompt_template: [pt('user', 'hi')],
          toolsEnabled: false,
        },
      }

      await (proc as any).executeNode(node, mockContextManager)
      expect(baseSpy).toHaveBeenCalledTimes(1)
      baseSpy.mockRestore()
    })
  })

  // Integration tests for the tools-enabled path live in plan §6 tests 2–5.
  // They require either a real workflow run harness or mocking the
  // `runWorkflowAiTurn` runner end-to-end; both are out of scope for this
  // unit suite.
  describe.todo('tools-enabled path — integration coverage (plan §6 tests 2–5)')
  describe.todo('structured-output second pass triggers on enabled + schema (plan §6 test 4)')
})
