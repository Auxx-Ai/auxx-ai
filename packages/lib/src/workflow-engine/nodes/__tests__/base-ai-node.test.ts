// packages/lib/src/workflow-engine/nodes/__tests__/base-ai-node.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Message } from '../../../ai/clients/base/types'
import type { ExecutionContextManager } from '../../core/execution-context'
import type { NodeExecutionResult, WorkflowNode } from '../../core/types'
import { NodeRunningStatus, WorkflowNodeType } from '../../core/types'
import { BaseAiNodeProcessor } from '../base-ai-node'
import type {
  InvokeOrchestratorResponse,
  StructuredOutputConfig,
} from '../utils/ai-invocation-utils'

/**
 * Test implementation of BaseAiNodeProcessor for testing
 */
class TestAiNodeProcessor extends BaseAiNodeProcessor {
  readonly type: WorkflowNodeType = WorkflowNodeType.AI

  protected async buildMessages(
    node: WorkflowNode,
    data: any,
    contextManager: ExecutionContextManager
  ): Promise<Message[]> {
    return [
      { role: 'system', content: 'You are a helpful assistant' },
      { role: 'user', content: data.prompt || 'Hello' },
    ]
  }

  protected async handleResponse(
    node: WorkflowNode,
    data: any,
    contextManager: ExecutionContextManager,
    response: InvokeOrchestratorResponse
  ): Promise<Partial<NodeExecutionResult>> {
    return {
      status: NodeRunningStatus.Succeeded,
      output: { result: response.content },
      outputHandle: 'source',
    }
  }

  protected getStructuredOutputConfig(
    node: WorkflowNode,
    data: any
  ): StructuredOutputConfig | undefined {
    return data.structuredOutput
  }
}

describe('BaseAiNodeProcessor', () => {
  let processor: TestAiNodeProcessor
  let mockContextManager: any

  beforeEach(() => {
    processor = new TestAiNodeProcessor()

    // Mock ExecutionContextManager
    mockContextManager = {
      getVariable: vi.fn((path: string) => {
        if (path === 'sys.organizationId') return 'org_test_123'
        if (path === 'sys.userId') return 'user_test_123'
        if (path === 'sys.workflow') return { id: 'workflow_123', name: 'Test Workflow' }
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
    it('should initialize with orchestrator and usage service', () => {
      expect(processor).toBeDefined()
      expect((processor as any).llmOrchestrator).toBeDefined()
      expect((processor as any).usageService).toBeDefined()
    })
  })

  describe('Abstract Methods', () => {
    it('should require buildMessages to be implemented', () => {
      const node: WorkflowNode = {
        nodeId: 'node_1',
        name: 'Test AI Node',
        type: WorkflowNodeType.AI,
        position: { x: 0, y: 0 },
        data: { prompt: 'Test prompt' },
      }

      // Should be able to call buildMessages
      expect(async () => {
        await (processor as any).buildMessages(node, node.data, mockContextManager)
      }).not.toThrow()
    })

    it('should require handleResponse to be implemented', async () => {
      const node: WorkflowNode = {
        nodeId: 'node_1',
        name: 'Test AI Node',
        type: WorkflowNodeType.AI,
        position: { x: 0, y: 0 },
        data: {},
      }

      const response: InvokeOrchestratorResponse = {
        content: 'Test response',
        model: 'gpt-4',
        provider: 'openai',
      }

      const result = await (processor as any).handleResponse(
        node,
        node.data,
        mockContextManager,
        response
      )

      expect(result).toBeDefined()
      expect(result.status).toBe(NodeRunningStatus.Succeeded)
    })

    it('should require getStructuredOutputConfig to be implemented', () => {
      const node: WorkflowNode = {
        nodeId: 'node_1',
        name: 'Test AI Node',
        type: WorkflowNodeType.AI,
        position: { x: 0, y: 0 },
        data: {},
      }

      const config = (processor as any).getStructuredOutputConfig(node, node.data)
      expect(config).toBeUndefined() // Our test implementation returns undefined by default
    })
  })

  describe('Default Methods', () => {
    it('should provide default temperature of 0.7', () => {
      const temp = (processor as any).getDefaultTemperature()
      expect(temp).toBe(0.7)
    })

    it('should return undefined for getTools by default', async () => {
      const node: WorkflowNode = {
        nodeId: 'node_1',
        name: 'Test AI Node',
        type: WorkflowNodeType.AI,
        position: { x: 0, y: 0 },
        data: {},
      }

      const tools = await (processor as any).getTools(
        node,
        node.data,
        undefined,
        mockContextManager
      )
      expect(tools).toBeUndefined()
    })

    it('should return undefined for getToolExecutor by default', async () => {
      const node: WorkflowNode = {
        nodeId: 'node_1',
        name: 'Test AI Node',
        type: WorkflowNodeType.AI,
        position: { x: 0, y: 0 },
        data: {},
      }

      const executor = await (processor as any).getToolExecutor(
        node,
        node.data,
        undefined,
        mockContextManager
      )
      expect(executor).toBeUndefined()
    })
  })

  describe('Variable Storage', () => {
    it('should store AI response in standard variables', () => {
      const node: WorkflowNode = {
        nodeId: 'node_1',
        name: 'Test AI Node',
        type: WorkflowNodeType.AI,
        position: { x: 0, y: 0 },
        data: {},
      }

      const response: InvokeOrchestratorResponse = {
        content: 'AI generated response',
        model: 'gpt-4',
        provider: 'openai',
      }

      // Call the private storeAIResponse method through executeNode
      ;(processor as any).storeAIResponse(node, mockContextManager, response, node.data)

      // Should store in standard locations
      expect(mockContextManager.setVariable).toHaveBeenCalledWith(
        'node_1.text',
        'AI generated response'
      )
      expect(mockContextManager.setNodeVariable).toHaveBeenCalledWith(
        'node_1',
        'output',
        'AI generated response'
      )
      expect(mockContextManager.setNodeVariable).toHaveBeenCalledWith(
        'node_1',
        'text',
        'AI generated response'
      )
    })

    it('should store structured output when present', () => {
      const node: WorkflowNode = {
        nodeId: 'node_1',
        name: 'Test AI Node',
        type: WorkflowNodeType.AI,
        position: { x: 0, y: 0 },
        data: {},
      }

      const response: InvokeOrchestratorResponse = {
        content: 'Response',
        model: 'gpt-4',
        provider: 'openai',
        structured_output: {
          category: 'test',
          confidence: 0.95,
        },
      }

      ;(processor as any).storeAIResponse(node, mockContextManager, response, node.data)

      // Should store structured output
      expect(mockContextManager.setNodeVariable).toHaveBeenCalledWith(
        'node_1',
        'structured_output',
        response.structured_output
      )
      // Should store individual fields
      expect(mockContextManager.setNodeVariable).toHaveBeenCalledWith('node_1', 'category', 'test')
      expect(mockContextManager.setNodeVariable).toHaveBeenCalledWith('node_1', 'confidence', 0.95)
    })

    it('should store tool results when present', () => {
      const node: WorkflowNode = {
        nodeId: 'node_1',
        name: 'Test AI Node',
        type: WorkflowNodeType.AI,
        position: { x: 0, y: 0 },
        data: {},
      }

      const response: InvokeOrchestratorResponse = {
        content: 'Response',
        model: 'gpt-4',
        provider: 'openai',
        tool_results: [
          {
            toolCallId: 'call_1',
            toolName: 'calculator',
            success: true,
            output: { result: 42 },
          },
        ],
      }

      ;(processor as any).storeAIResponse(node, mockContextManager, response, node.data)

      // Should store tool results
      expect(mockContextManager.setNodeVariable).toHaveBeenCalledWith(
        'node_1',
        'tool_results',
        response.tool_results
      )
      // Should store indexed tool result
      expect(mockContextManager.setNodeVariable).toHaveBeenCalledWith('node_1', 'tool_0', {
        result: 42,
      })
      // Should store named tool result
      expect(mockContextManager.setNodeVariable).toHaveBeenCalledWith('node_1', 'tool_calculator', {
        result: 42,
      })
    })

    it('should use custom output variable if specified', () => {
      const node: WorkflowNode = {
        nodeId: 'node_1',
        name: 'Test AI Node',
        type: WorkflowNodeType.AI,
        position: { x: 0, y: 0 },
        data: { outputVariable: 'custom.output' },
      }

      const response: InvokeOrchestratorResponse = {
        content: 'Response',
        model: 'gpt-4',
        provider: 'openai',
      }

      ;(processor as any).storeAIResponse(node, mockContextManager, response, node.data)

      expect(mockContextManager.setVariable).toHaveBeenCalledWith('custom.output', 'Response')
    })
  })

  describe('Error Handling', () => {
    it('should throw error if node data is missing', async () => {
      const node: WorkflowNode = {
        nodeId: 'node_1',
        name: 'Test AI Node',
        type: WorkflowNodeType.AI,
        position: { x: 0, y: 0 },
        data: null as any,
      }

      await expect((processor as any).executeNode(node, mockContextManager)).rejects.toThrow(
        'AI node configuration is missing'
      )
    })

    it('should throw error if organization ID is missing', async () => {
      mockContextManager.getVariable.mockImplementation((path: string) => {
        if (path === 'sys.userId') return 'user_123'
        return undefined
      })

      const node: WorkflowNode = {
        nodeId: 'node_1',
        name: 'Test AI Node',
        type: WorkflowNodeType.AI,
        position: { x: 0, y: 0 },
        data: { prompt: 'Test' },
      }

      await expect((processor as any).executeNode(node, mockContextManager)).rejects.toThrow(
        'Organization ID is required'
      )
    })

    it('should throw error if user ID is missing', async () => {
      mockContextManager.getVariable.mockImplementation((path: string) => {
        if (path === 'sys.organizationId') return 'org_123'
        return undefined
      })

      const node: WorkflowNode = {
        nodeId: 'node_1',
        name: 'Test AI Node',
        type: WorkflowNodeType.AI,
        position: { x: 0, y: 0 },
        data: { prompt: 'Test' },
      }

      await expect((processor as any).executeNode(node, mockContextManager)).rejects.toThrow(
        'User ID is required'
      )
    })
  })
})
