// packages/lib/src/workflow-engine/nodes/action-nodes/__tests__/ai-v2.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { textToDoc } from '../../../../tiptap'
import type { NodeData, WorkflowNode } from '../../../core/types'
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
 * Builds an AI node in the shape `WorkflowGraphBuilder.transformNodes` emits:
 * `id`/`nodeId` mirror the canvas node id and the canvas position sits in metadata.
 */
const aiNode = (data: Partial<NodeData>): WorkflowNode => ({
  id: 'node_1',
  workflowId: 'workflow_123',
  nodeId: 'node_1',
  name: 'AI Node',
  type: WorkflowNodeType.AI,
  data: { id: 'node_1', type: WorkflowNodeType.AI, title: 'AI Node', ...data },
  metadata: { position: { x: 0, y: 0 } },
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
      const node = aiNode({
        model: { provider: 'openai', name: 'gpt-4' },
        prompt_template: [pt('system', 'You are a helpful assistant'), pt('user', 'Hello, world!')],
      })

      const messages = await (processor as any).buildMessages(node, node.data, mockContextManager)

      expect(messages).toHaveLength(2)
      expect(messages[0]).toEqual({ role: 'system', content: 'You are a helpful assistant' })
      expect(messages[1]).toEqual({ role: 'user', content: 'Hello, world!' })
    })

    it('should interpolate variables in prompt templates', async () => {
      const node = aiNode({
        model: { provider: 'openai', name: 'gpt-4' },
        prompt_template: [
          pt('system', 'You are a helpful assistant'),
          pt('user', 'Email: {{webhook.email}}, Subject: {{webhook.subject}}'),
        ],
      })

      const messages = await (processor as any).buildMessages(node, node.data, mockContextManager)

      expect(messages[1].content).toBe('Email: test@example.com, Subject: Test Subject')
    })
  })

  // `prompt_template[]` is the only prompt source. The flat `prompt` /
  // `systemPrompt` pair it superseded has no writer anywhere in the builder —
  // not the panel, not the zod schema, not `AiNodeData` — so the branch that
  // read them was unreachable and is gone rather than duplicated.
  describe('buildMessages - the removed legacy prompt fields', () => {
    it('throws on a node carrying only the legacy prompt/systemPrompt pair', async () => {
      const node = aiNode({
        model: { provider: 'openai', name: 'gpt-4' },
        systemPrompt: 'You are a poet',
        prompt: 'Write me a poem',
      } as any)

      await expect(
        (processor as any).buildMessages(node, node.data, mockContextManager)
      ).rejects.toThrow('AI node has no prompt_template configured')
    })

    it('should throw error if no prompt configuration found', async () => {
      const node = aiNode({
        model: { provider: 'openai', name: 'gpt-4' },
      })

      await expect(
        (processor as any).buildMessages(node, node.data, mockContextManager)
      ).rejects.toThrow('AI node has no prompt_template configured')
    })
  })

  describe('getStructuredOutputConfig', () => {
    it('should return undefined when structured output is disabled', () => {
      const node = aiNode({
        structured_output: { enabled: false },
      })

      const config = (processor as any).getStructuredOutputConfig(node, node.data)
      expect(config).toBeUndefined()
    })

    it('should return undefined when structured output is not configured', () => {
      const node = aiNode({})

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

      const node = aiNode({
        structured_output: {
          enabled: true,
          schema,
        },
      })

      const config = (processor as any).getStructuredOutputConfig(node, node.data)
      expect(config).toEqual({
        enabled: true,
        schema,
      })
    })
  })

  describe('extractRequiredVariables', () => {
    it('should extract variables from prompt_template', () => {
      const node = aiNode({
        prompt_template: [
          pt('system', 'You are a helpful assistant'),
          pt('user', 'Email: {{webhook.email}}, Name: {{webhook.name}}'),
        ],
      })

      const variables = (processor as any).extractRequiredVariables(node)
      expect(variables).toContain('webhook.email')
      expect(variables).toContain('webhook.name')
    })

    it('ignores the removed legacy prompt / systemPrompt fields', () => {
      const node = aiNode({
        systemPrompt: 'Context: {{sys.context}}',
        prompt: 'Summarize: {{article.content}}',
      } as any)

      const variables = (processor as any).extractRequiredVariables(node)
      expect(variables).toEqual([])
    })

    it('ignores legacy context config (dead setting removed)', () => {
      const node = aiNode({
        prompt_template: [pt('user', 'Hello')],
        context: {
          enabled: true,
          variable_selector: ['workflow.state', 'user.preferences'],
        },
      })

      const variables = (processor as any).extractRequiredVariables(node)
      expect(variables).not.toContain('workflow.state')
      expect(variables).not.toContain('user.preferences')
    })

    it('should return unique variables only', () => {
      const node = aiNode({
        prompt_template: [
          pt('system', 'Email: {{webhook.email}}'),
          pt('user', 'Also email: {{webhook.email}}'),
        ],
      })

      const variables = (processor as any).extractRequiredVariables(node)
      const emailCount = variables.filter((v: string) => v === 'webhook.email').length
      expect(emailCount).toBe(1)
    })
  })

  describe('validateNodeConfig', () => {
    it('should validate prompt_template configuration', async () => {
      const node = aiNode({
        model: { provider: 'openai', name: 'gpt-4' },
        prompt_template: [pt('user', 'Hello')],
      })

      const result = await (processor as any).validateNodeConfig(node)
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('rejects a node carrying only the legacy prompt field', async () => {
      const node = aiNode({
        model: { provider: 'openai', name: 'gpt-4' },
        prompt: 'Hello world',
      } as any)

      const result = await (processor as any).validateNodeConfig(node)
      expect(result.valid).toBe(false)
      expect(result.errors.join(' ')).toContain("Expected 'prompt_template' array")
    })

    it('should fail validation without prompt', async () => {
      const node = aiNode({
        model: { provider: 'openai', name: 'gpt-4' },
      })

      const result = await (processor as any).validateNodeConfig(node)
      expect(result.valid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
    })

    it('should validate temperature range', async () => {
      const node = aiNode({
        model: {
          provider: 'openai',
          name: 'gpt-4',
          completion_params: { temperature: 3.0 },
        },
        prompt_template: [pt('user', 'Hello')],
      })

      const result = await (processor as any).validateNodeConfig(node)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Temperature must be a number between 0 and 2')
    })

    it('should validate max_tokens is positive', async () => {
      const node = aiNode({
        model: {
          provider: 'openai',
          name: 'gpt-4',
          completion_params: { max_tokens: -100 },
        },
        prompt_template: [pt('user', 'Hello')],
      })

      const result = await (processor as any).validateNodeConfig(node)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Max tokens must be a positive number')
    })

    it('should validate structured output schema', async () => {
      const node = aiNode({
        model: { provider: 'openai', name: 'gpt-4' },
        prompt_template: [pt('user', 'Hello')],
        structured_output: {
          enabled: true,
          // Missing schema
        },
      })

      const result = await (processor as any).validateNodeConfig(node)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Structured output is enabled but no schema is defined')
    })

    it('should accept toolsEnabled with toolsets array', async () => {
      const node = aiNode({
        model: { provider: 'openai', name: 'gpt-4' },
        prompt_template: [pt('user', 'Hello')],
        toolsEnabled: true,
        toolsets: [{ slug: 'workflow.variable', enabled: true, source: 'manual' }],
      })

      const result = await (processor as any).validateNodeConfig(node)
      expect(result.valid).toBe(true)
    })

    it('should reject invalid maxIterations on a tools-enabled node', async () => {
      const node = aiNode({
        model: { provider: 'openai', name: 'gpt-4' },
        prompt_template: [pt('user', 'Hello')],
        toolsEnabled: true,
        toolsets: [],
        maxIterations: 0,
      })

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

      const node = aiNode({
        model: { provider: 'openai', name: 'gpt-4' },
        prompt_template: [pt('user', 'hi')],
        toolsEnabled: false,
      })

      await (proc as any).executeNode(node, mockContextManager)
      expect(baseSpy).toHaveBeenCalledTimes(1)
      baseSpy.mockRestore()
    })
  })

  /**
   * Failure policy (plan 21 step 4 / §18.1). The AI node has always signalled
   * failure by THROWING, which is why it never appeared in §7.4's
   * `outputHandle: 'error'` hunt — but a model call fails transiently far more
   * often than a transform does, so it is opted in with all three strategies.
   *
   * The acceptance criterion is behaviour preservation: an `ai` node with no
   * stored `error_strategy` — every row that predates the opt-in — must keep
   * killing the run. It does, by RE-THROWING: `fail` is the resolved default,
   * and the throw is exactly what happened before.
   */
  describe('failure policy', () => {
    const failingBase = (proc: AIProcessorV2) =>
      vi
        .spyOn(Object.getPrototypeOf(Object.getPrototypeOf(proc)), 'executeNode')
        .mockRejectedValue(new Error('model timed out'))

    const node = (data: Record<string, unknown> = {}) =>
      aiNode({
        model: { provider: 'openai', name: 'gpt-4' },
        prompt_template: [pt('user', 'hi')],
        toolsEnabled: false,
        ...data,
      })

    it('re-throws for a node with no stored error_strategy', async () => {
      const proc = new AIProcessorV2()
      const spy = failingBase(proc)
      await expect((proc as any).executeNode(node(), mockContextManager)).rejects.toThrow(
        'model timed out'
      )
      spy.mockRestore()
    })

    it('re-throws for an explicit `fail` too — the branch is the wiring, not the swallow', async () => {
      // `fail` does NOT mean "return a Failed result and hope"; the engine's
      // own `findFailureEdge` routing is what a wired fail branch uses, and an
      // UNWIRED one must still kill the run.
      const proc = new AIProcessorV2()
      const spy = failingBase(proc)
      await expect(
        (proc as any).executeNode(node({ error_strategy: 'fail' }), mockContextManager)
      ).rejects.toThrow('model timed out')
      spy.mockRestore()
    })

    it('`continue` succeeds on `source` and keeps `text` addressable', async () => {
      const proc = new AIProcessorV2()
      const spy = failingBase(proc)
      const result = await (proc as any).executeNode(
        node({ error_strategy: 'continue' }),
        mockContextManager
      )
      expect(result.outputHandle).toBe('source')
      expect(result.output).toMatchObject({ text: '', success: false, error: 'model timed out' })
      expect(mockContextManager.setNodeVariable).toHaveBeenCalledWith('node_1', 'text', '')
      spy.mockRestore()
    })

    it("`default` substitutes the configured values onto the node's own outputs", async () => {
      // "If the classifier times out, use `unknown`" (plan 21 §16.3) — the
      // reason `default` is offered here and nowhere else in the step-4 set.
      const proc = new AIProcessorV2()
      const spy = failingBase(proc)
      const result = await (proc as any).executeNode(
        node({
          error_strategy: 'default',
          default_values: [{ key: 'text', type: 'string', value: 'unknown' }],
        }),
        mockContextManager
      )
      expect(result.outputHandle).toBe('source')
      expect(result.output).toMatchObject({ text: 'unknown', usedDefaults: true })
      expect(mockContextManager.setNodeVariable).toHaveBeenCalledWith('node_1', 'text', 'unknown')
      spy.mockRestore()
    })

    it('`default` with nothing configured falls through to fatal', async () => {
      // Substituting nothing cannot succeed. Same shape as http's and crud's
      // `default` arms, which both require a non-empty list.
      const proc = new AIProcessorV2()
      const spy = failingBase(proc)
      await expect(
        (proc as any).executeNode(
          node({ error_strategy: 'default', default_values: [] }),
          mockContextManager
        )
      ).rejects.toThrow('model timed out')
      spy.mockRestore()
    })
  })

  // Integration tests for the tools-enabled path live in plan §6 tests 2–5.
  // They require either a real workflow run harness or mocking the
  // `runWorkflowAiTurn` runner end-to-end; both are out of scope for this
  // unit suite.
  describe.todo('tools-enabled path — integration coverage (plan §6 tests 2–5)')
  describe.todo('structured-output second pass triggers on enabled + schema (plan §6 test 4)')
})
