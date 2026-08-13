// packages/lib/src/workflow-engine/core/__tests__/loop-execution-manager.test.ts
import type { Mock } from 'vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ExecutionContextManager } from '../execution-context'
import type { NodeExecutionCallback } from '../loop-execution-manager'
import { LoopExecutionManager } from '../loop-execution-manager'
import type {
  NodeData,
  NodeExecutionResult,
  Workflow,
  WorkflowExecutionOptions,
  WorkflowNode,
} from '../types'
import { NodeRunningStatus, WorkflowNodeType, WorkflowTriggerType } from '../types'

/**
 * Builds a node in the same shape `WorkflowGraphBuilder.transformNodes` produces:
 * `id`/`nodeId` mirror the canvas node id and the canvas position lives in metadata.
 */
const createNode = (
  nodeId: string,
  type: WorkflowNodeType,
  name: string,
  data: Partial<NodeData> = {}
): WorkflowNode => ({
  id: nodeId,
  workflowId: 'workflow-1',
  nodeId,
  type,
  name,
  data: { id: nodeId, type, title: name, ...data },
  metadata: { position: { x: 0, y: 0 } },
})

/**
 * The loop manager injects these two callbacks onto the processor for the
 * duration of `setupLoopExecution` and deletes them again afterwards.
 */
interface LoopProcessorMock {
  preprocessNode: Mock
  execute: Mock
  executeLoopBodyCallback?: (
    node: WorkflowNode,
    contextManager: ExecutionContextManager
  ) => Promise<unknown>
  progressCallback?: (update: { nodeId: string; progress: unknown }) => Promise<void>
}

/**
 * Invokes the loop-body callback the manager injects onto the processor,
 * failing loudly rather than silently no-op'ing if it was never injected.
 */
const runLoopBody = (
  processor: LoopProcessorMock,
  node: WorkflowNode,
  contextManager: ExecutionContextManager
) => {
  if (!processor.executeLoopBodyCallback) {
    throw new Error('executeLoopBodyCallback was not injected onto the processor')
  }
  return processor.executeLoopBodyCallback(node, contextManager)
}

describe('LoopExecutionManager', () => {
  let manager: LoopExecutionManager
  let executeNodeCallback: Mock<NodeExecutionCallback>
  let contextManager: ExecutionContextManager
  let mockWorkflow: Workflow

  beforeEach(() => {
    executeNodeCallback = vi.fn<NodeExecutionCallback>()
    manager = new LoopExecutionManager(executeNodeCallback)

    contextManager = new ExecutionContextManager(
      'workflow-1',
      'exec-1',
      'org-1',
      'user-1',
      'user@example.com',
      'Test User',
      'Test Org',
      'test-org'
    )

    mockWorkflow = {
      id: 'workflow-1',
      workflowId: 'workflow-1',
      workflowAppId: 'app-1',
      organizationId: 'org-1',
      name: 'Test Workflow',
      enabled: true,
      version: 1,
      triggerType: WorkflowTriggerType.MANUAL,
      nodes: [],
      graph: {
        nodes: [],
        edges: [],
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    }
  })

  describe('setupLoopExecution', () => {
    it('should inject executeLoopBodyCallback into processor', async () => {
      const loopNode = createNode('loop-1', WorkflowNodeType.LOOP, 'Test Loop')

      let capturedCallback: any
      const mockProcessor: LoopProcessorMock = {
        preprocessNode: vi.fn().mockResolvedValue({}),
        execute: vi.fn().mockImplementation(async () => {
          // Capture the callback while it exists
          capturedCallback = mockProcessor.executeLoopBodyCallback
          return {
            nodeId: 'loop-1',
            status: NodeRunningStatus.Succeeded,
            output: { iterations: 3 },
            executionTime: 100,
          }
        }),
      }

      const options: WorkflowExecutionOptions = {}

      await manager.setupLoopExecution(
        loopNode,
        mockProcessor,
        contextManager,
        options,
        mockWorkflow
      )

      // Verify callback was injected (captured during execution)
      expect(capturedCallback).toBeDefined()
      expect(typeof capturedCallback).toBe('function')

      // Verify processor was executed
      expect(mockProcessor.execute).toHaveBeenCalledWith(loopNode, contextManager, {})
    })

    it('should inject progressCallback when onNodeComplete is provided', async () => {
      const loopNode = createNode('loop-1', WorkflowNodeType.LOOP, 'Test Loop')

      let capturedProgressCallback: any
      const mockProcessor: LoopProcessorMock = {
        preprocessNode: vi.fn().mockResolvedValue({}),
        execute: vi.fn().mockImplementation(async () => {
          // Capture the progress callback while it exists
          capturedProgressCallback = mockProcessor.progressCallback
          return {
            nodeId: 'loop-1',
            status: NodeRunningStatus.Succeeded,
            output: { iterations: 3 },
            executionTime: 100,
          }
        }),
      }

      const onNodeComplete = vi.fn()
      const options: WorkflowExecutionOptions = { onNodeComplete }

      await manager.setupLoopExecution(
        loopNode,
        mockProcessor,
        contextManager,
        options,
        mockWorkflow
      )

      // Verify progress callback was injected (captured during execution)
      expect(capturedProgressCallback).toBeDefined()
      expect(typeof capturedProgressCallback).toBe('function')
    })

    it('should clean up callbacks after execution', async () => {
      const loopNode = createNode('loop-1', WorkflowNodeType.LOOP, 'Test Loop')

      const mockProcessor: LoopProcessorMock = {
        preprocessNode: vi.fn().mockResolvedValue({}),
        execute: vi.fn().mockResolvedValue({
          nodeId: 'loop-1',
          status: NodeRunningStatus.Succeeded,
          output: { iterations: 3 },
          executionTime: 100,
        }),
      }

      const options: WorkflowExecutionOptions = {}

      await manager.setupLoopExecution(
        loopNode,
        mockProcessor,
        contextManager,
        options,
        mockWorkflow
      )

      // Verify callbacks were cleaned up
      expect(mockProcessor.executeLoopBodyCallback).toBeUndefined()
      expect(mockProcessor.progressCallback).toBeUndefined()
    })

    it('should clean up callbacks even if execution throws', async () => {
      const loopNode = createNode('loop-1', WorkflowNodeType.LOOP, 'Test Loop')

      const mockProcessor: LoopProcessorMock = {
        preprocessNode: vi.fn().mockResolvedValue({}),
        execute: vi.fn().mockRejectedValue(new Error('Execution failed')),
      }

      const options: WorkflowExecutionOptions = {}

      await expect(
        manager.setupLoopExecution(loopNode, mockProcessor, contextManager, options, mockWorkflow)
      ).rejects.toThrow('Execution failed')

      // Verify callbacks were cleaned up even after error
      expect(mockProcessor.executeLoopBodyCallback).toBeUndefined()
      expect(mockProcessor.progressCallback).toBeUndefined()
    })

    it('should call progress callback with correct data', async () => {
      const loopNode = createNode('loop-1', WorkflowNodeType.LOOP, 'Test Loop')

      let capturedProgressCallback: any
      const mockProcessor: LoopProcessorMock = {
        preprocessNode: vi.fn().mockResolvedValue({}),
        execute: vi.fn().mockImplementation(async () => {
          // Capture the progress callback
          capturedProgressCallback = mockProcessor.progressCallback
          return {
            nodeId: 'loop-1',
            status: NodeRunningStatus.Succeeded,
            output: { iterations: 3 },
            executionTime: 100,
          }
        }),
      }

      const onNodeComplete = vi.fn()
      const options: WorkflowExecutionOptions = { onNodeComplete }

      await manager.setupLoopExecution(
        loopNode,
        mockProcessor,
        contextManager,
        options,
        mockWorkflow
      )

      // Call the captured progress callback
      await capturedProgressCallback({
        nodeId: 'loop-1',
        progress: {
          currentIteration: 2,
          totalIterations: 5,
        },
      })

      // Verify onNodeComplete was called with correct data
      expect(onNodeComplete).toHaveBeenCalledWith(
        'loop-1',
        expect.objectContaining({
          nodeId: 'loop-1',
          status: NodeRunningStatus.Running,
          output: expect.objectContaining({
            progress: {
              currentIteration: 2,
              totalIterations: 5,
            },
          }),
          metadata: {
            type: 'loop_progress',
            iteration: 2,
            total: 5,
          },
        }),
        expect.any(Object)
      )
    })
  })

  describe('executeLoopBody', () => {
    it('should throw error if workflow has no edges', async () => {
      const loopNode = createNode('loop-1', WorkflowNodeType.LOOP, 'Test Loop')

      const workflowNoEdges = {
        ...mockWorkflow,
        graph: undefined,
      }

      const mockProcessor: LoopProcessorMock = {
        preprocessNode: vi.fn().mockResolvedValue({}),
        execute: vi.fn().mockImplementation(async () => {
          // Call the callback
          return await runLoopBody(mockProcessor, loopNode, contextManager)
        }),
      }

      const options: WorkflowExecutionOptions = {}

      await expect(
        manager.setupLoopExecution(
          loopNode,
          mockProcessor,
          contextManager,
          options,
          workflowNoEdges
        )
      ).rejects.toThrow('Workflow graph edges are required for loop execution')
    })

    it('should return null if no loop-start connection found', async () => {
      const loopNode = createNode('loop-1', WorkflowNodeType.LOOP, 'Test Loop')

      const workflowNoStart = {
        ...mockWorkflow,
        graph: {
          nodes: [],
          edges: [], // No edges = no loop-start connection
        },
      }

      let result: any
      const mockProcessor: LoopProcessorMock = {
        preprocessNode: vi.fn().mockResolvedValue({}),
        execute: vi.fn().mockImplementation(async () => {
          // Call the callback and capture result
          result = await runLoopBody(mockProcessor, loopNode, contextManager)
          return {
            nodeId: 'loop-1',
            status: NodeRunningStatus.Succeeded,
            output: result,
            executionTime: 100,
          }
        }),
      }

      const options: WorkflowExecutionOptions = {}

      await manager.setupLoopExecution(
        loopNode,
        mockProcessor,
        contextManager,
        options,
        workflowNoStart
      )

      expect(result).toBeNull()
    })

    it('should execute loop body nodes and return last result', async () => {
      const loopNode = createNode('loop-1', WorkflowNodeType.LOOP, 'Test Loop')

      const bodyNode = createNode('body-1', WorkflowNodeType.CODE, 'Body Node')

      // Need end node that connects back to loop (has loop-back edge)
      const endNode = createNode('end-1', WorkflowNodeType.END, 'End Node')

      const workflowWithBody = {
        ...mockWorkflow,
        nodes: [loopNode, bodyNode, endNode],
        graph: {
          nodes: [loopNode, bodyNode, endNode],
          edges: [
            {
              id: 'e1',
              source: 'loop-1',
              target: 'body-1',
              sourceHandle: 'loop-start',
              targetHandle: 'target',
            },
            {
              id: 'e2',
              source: 'body-1',
              target: 'end-1',
              sourceHandle: 'source',
              targetHandle: 'target',
            },
            {
              id: 'e3',
              source: 'end-1',
              target: 'loop-1',
              sourceHandle: 'source',
              targetHandle: 'loop-back',
            },
          ],
        },
      }

      // Mock executeNodeCallback to return a result
      executeNodeCallback.mockImplementation(async (node: WorkflowNode) => {
        return {
          nodeId: node.nodeId,
          status: NodeRunningStatus.Succeeded,
          output: { result: 'success', nodeId: node.nodeId },
          executionTime: 50,
        }
      })

      let result: any
      const mockProcessor: LoopProcessorMock = {
        preprocessNode: vi.fn().mockResolvedValue({}),
        execute: vi.fn().mockImplementation(async () => {
          result = await runLoopBody(mockProcessor, loopNode, contextManager)
          return {
            nodeId: 'loop-1',
            status: NodeRunningStatus.Succeeded,
            output: result,
            executionTime: 100,
          }
        }),
      }

      const options: WorkflowExecutionOptions = {}

      await manager.setupLoopExecution(
        loopNode,
        mockProcessor,
        contextManager,
        options,
        workflowWithBody
      )

      // Verify executeNodeCallback was called for both body node and end node
      // body-1 executes, resolveNextNodeForLoop finds end-1 (not loop-back)
      // end-1 executes, resolveNextNodeForLoop finds loop-back edge to loop-1, returns null
      expect(executeNodeCallback).toHaveBeenCalledWith(bodyNode, contextManager, options)
      expect(executeNodeCallback).toHaveBeenCalledWith(endNode, contextManager, options)
      expect(executeNodeCallback).toHaveBeenCalledTimes(2)

      // Verify result contains the output from last executed node (end-1)
      expect(result).toEqual({ result: 'success', nodeId: 'end-1' })
    })
  })

  describe('executeLoopBodyNodes', () => {
    it('should stop at loop-back connection', async () => {
      const loopNode = createNode('loop-1', WorkflowNodeType.LOOP, 'Test Loop')

      const bodyNode1 = createNode('body-1', WorkflowNodeType.CODE, 'Body Node 1')

      const bodyNode2 = createNode('body-2', WorkflowNodeType.CODE, 'Body Node 2')

      const workflowWithMultipleNodes = {
        ...mockWorkflow,
        nodes: [loopNode, bodyNode1, bodyNode2],
        graph: {
          nodes: [loopNode, bodyNode1, bodyNode2],
          edges: [
            {
              id: 'e1',
              source: 'loop-1',
              target: 'body-1',
              sourceHandle: 'loop-start',
              targetHandle: 'target',
            },
            {
              id: 'e2',
              source: 'body-1',
              target: 'body-2',
              sourceHandle: 'source',
              targetHandle: 'target',
            },
            {
              id: 'e3',
              source: 'body-2',
              target: 'loop-1',
              sourceHandle: 'source',
              targetHandle: 'loop-back',
            },
          ],
        },
      }

      let callCount = 0
      executeNodeCallback.mockImplementation(async (node: WorkflowNode) => {
        callCount++
        return {
          nodeId: node.nodeId,
          status: NodeRunningStatus.Succeeded,
          output: { step: callCount },
          executionTime: 50,
        }
      })

      let result: any
      const mockProcessor: LoopProcessorMock = {
        preprocessNode: vi.fn().mockResolvedValue({}),
        execute: vi.fn().mockImplementation(async () => {
          result = await runLoopBody(mockProcessor, loopNode, contextManager)
          return {
            nodeId: 'loop-1',
            status: NodeRunningStatus.Succeeded,
            output: result,
            executionTime: 100,
          }
        }),
      }

      const options: WorkflowExecutionOptions = {}

      await manager.setupLoopExecution(
        loopNode,
        mockProcessor,
        contextManager,
        options,
        workflowWithMultipleNodes
      )

      // Should execute both body nodes (body-1 and body-2)
      // body-1 executes, resolveNextNodeForLoop finds body-2 (not loop-back)
      // body-2 executes, resolveNextNodeForLoop finds loop-back edge to loop-1, returns null
      // So both body-1 and body-2 execute
      expect(callCount).toBe(2)
      expect(executeNodeCallback).toHaveBeenCalledTimes(2)
      expect(executeNodeCallback).toHaveBeenCalledWith(bodyNode1, contextManager, options)
      expect(executeNodeCallback).toHaveBeenCalledWith(bodyNode2, contextManager, options)
    })

    it('should detect cycles within loop body', async () => {
      const loopNode = createNode('loop-1', WorkflowNodeType.LOOP, 'Test Loop')

      const bodyNode = createNode('body-1', WorkflowNodeType.CODE, 'Body Node')

      // Create a cycle within loop body (not loop-back)
      const workflowWithCycle = {
        ...mockWorkflow,
        nodes: [loopNode, bodyNode],
        graph: {
          nodes: [loopNode, bodyNode],
          edges: [
            {
              id: 'e1',
              source: 'loop-1',
              target: 'body-1',
              sourceHandle: 'loop-start',
              targetHandle: 'target',
            },
            {
              id: 'e2',
              source: 'body-1',
              target: 'body-1',
              sourceHandle: 'source',
              targetHandle: 'target',
            }, // Cycle
          ],
        },
      }

      executeNodeCallback.mockResolvedValue({
        nodeId: 'body-1',
        status: NodeRunningStatus.Succeeded,
        output: { result: 'success' },
        executionTime: 50,
      })

      const mockProcessor: LoopProcessorMock = {
        preprocessNode: vi.fn().mockResolvedValue({}),
        execute: vi.fn().mockImplementation(async () => {
          return await runLoopBody(mockProcessor, loopNode, contextManager)
        }),
      }

      const options: WorkflowExecutionOptions = {}

      // Should not throw, but should stop due to cycle detection
      await manager.setupLoopExecution(
        loopNode,
        mockProcessor,
        contextManager,
        options,
        workflowWithCycle
      )

      // Should only execute once (then detect cycle)
      expect(executeNodeCallback).toHaveBeenCalledTimes(1)
    })

    it('should propagate node failure errors', async () => {
      const loopNode = createNode('loop-1', WorkflowNodeType.LOOP, 'Test Loop')

      const bodyNode = createNode('body-1', WorkflowNodeType.CODE, 'Body Node')

      const workflowWithBody = {
        ...mockWorkflow,
        nodes: [loopNode, bodyNode],
        graph: {
          nodes: [loopNode, bodyNode],
          edges: [
            {
              id: 'e1',
              source: 'loop-1',
              target: 'body-1',
              sourceHandle: 'loop-start',
              targetHandle: 'target',
            },
          ],
        },
      }

      // Mock node failure
      executeNodeCallback.mockResolvedValue({
        nodeId: 'body-1',
        status: NodeRunningStatus.Failed,
        error: 'Node execution failed',
        executionTime: 50,
      })

      const mockProcessor: LoopProcessorMock = {
        preprocessNode: vi.fn().mockResolvedValue({}),
        execute: vi.fn().mockImplementation(async () => {
          return await runLoopBody(mockProcessor, loopNode, contextManager)
        }),
      }

      const options: WorkflowExecutionOptions = {}

      await expect(
        manager.setupLoopExecution(
          loopNode,
          mockProcessor,
          contextManager,
          options,
          workflowWithBody
        )
      ).rejects.toThrow('Node body-1 failed within loop')
    })

    it('should route a failed body node to its wired fail branch', async () => {
      const loopNode = createNode('loop-1', WorkflowNodeType.LOOP, 'Test Loop')
      const bodyNode = createNode('body-1', WorkflowNodeType.CODE, 'Body Node')
      const handlerNode = createNode('handler-1', WorkflowNodeType.CODE, 'Fail Handler')

      const workflowWithFailBranch = {
        ...mockWorkflow,
        nodes: [loopNode, bodyNode, handlerNode],
        graph: {
          nodes: [loopNode, bodyNode, handlerNode],
          edges: [
            {
              id: 'e1',
              source: 'loop-1',
              target: 'body-1',
              sourceHandle: 'loop-start',
              targetHandle: 'target',
            },
            {
              id: 'e2',
              source: 'body-1',
              target: 'handler-1',
              sourceHandle: 'fail',
              targetHandle: 'target',
            },
            {
              id: 'e3',
              source: 'handler-1',
              target: 'loop-1',
              sourceHandle: 'source',
              targetHandle: 'loop-back',
            },
          ],
        },
      }

      executeNodeCallback.mockImplementation(async (node: WorkflowNode) => {
        if (node.nodeId === 'body-1') {
          return {
            nodeId: node.nodeId,
            status: NodeRunningStatus.Failed,
            error: 'boom',
            outputHandle: 'fail',
            executionTime: 50,
          }
        }
        return {
          nodeId: node.nodeId,
          status: NodeRunningStatus.Succeeded,
          output: { handled: true },
          executionTime: 50,
        }
      })

      const mockProcessor: LoopProcessorMock = {
        preprocessNode: vi.fn().mockResolvedValue({}),
        execute: vi.fn().mockImplementation(async () => {
          return await runLoopBody(mockProcessor, loopNode, contextManager)
        }),
      }

      const options: WorkflowExecutionOptions = {}

      await manager.setupLoopExecution(
        loopNode,
        mockProcessor,
        contextManager,
        options,
        workflowWithFailBranch
      )

      expect(executeNodeCallback).toHaveBeenCalledWith(bodyNode, contextManager, options)
      expect(executeNodeCallback).toHaveBeenCalledWith(handlerNode, contextManager, options)
    })
  })

  describe('isLoopBackConnection', () => {
    it('should return true for loop-back edges', () => {
      const bodyNode = createNode('body-1', WorkflowNodeType.CODE, 'Body Node')

      const workflowWithLoopBack = {
        ...mockWorkflow,
        graph: {
          nodes: [],
          edges: [
            {
              id: 'e1',
              source: 'body-1',
              target: 'loop-1',
              sourceHandle: 'source',
              targetHandle: 'loop-back',
            },
          ],
        },
      }

      // Access private method via any cast for testing
      const isLoopBack = (manager as any).isLoopBackConnection(
        bodyNode,
        'loop-1',
        workflowWithLoopBack
      )

      expect(isLoopBack).toBe(true)
    })

    it('should return false for non-loop-back edges', () => {
      const bodyNode = createNode('body-1', WorkflowNodeType.CODE, 'Body Node')

      const workflowWithoutLoopBack = {
        ...mockWorkflow,
        graph: {
          nodes: [],
          edges: [
            {
              id: 'e1',
              source: 'body-1',
              target: 'body-2',
              sourceHandle: 'source',
              targetHandle: 'target',
            },
          ],
        },
      }

      const isLoopBack = (manager as any).isLoopBackConnection(
        bodyNode,
        'loop-1',
        workflowWithoutLoopBack
      )

      expect(isLoopBack).toBe(false)
    })
  })

  describe('resolveNextNodeForLoop', () => {
    it('should return null for loop-back edges', () => {
      const bodyNode = createNode('body-1', WorkflowNodeType.CODE, 'Body Node')

      const workflowWithLoopBack = {
        ...mockWorkflow,
        graph: {
          nodes: [],
          edges: [
            {
              id: 'e1',
              source: 'body-1',
              target: 'loop-1',
              sourceHandle: 'source',
              targetHandle: 'loop-back',
            },
          ],
        },
      }

      const result: NodeExecutionResult = {
        nodeId: 'body-1',
        status: NodeRunningStatus.Succeeded,
        output: {},
        executionTime: 50,
      }

      const nextNode = (manager as any).resolveNextNodeForLoop(
        bodyNode,
        result,
        'loop-1',
        workflowWithLoopBack
      )

      expect(nextNode).toBeNull()
    })

    it('should return next node for forward edges', () => {
      const bodyNode = createNode('body-1', WorkflowNodeType.CODE, 'Body Node')

      const workflowWithNext = {
        ...mockWorkflow,
        graph: {
          nodes: [],
          edges: [
            {
              id: 'e1',
              source: 'body-1',
              target: 'body-2',
              sourceHandle: 'source',
              targetHandle: 'target',
            },
          ],
        },
      }

      const result: NodeExecutionResult = {
        nodeId: 'body-1',
        status: NodeRunningStatus.Succeeded,
        output: {},
        executionTime: 50,
      }

      const nextNode = (manager as any).resolveNextNodeForLoop(
        bodyNode,
        result,
        'loop-1',
        workflowWithNext
      )

      expect(nextNode).toBe('body-2')
    })

    it('should use outputHandle for routing', () => {
      const bodyNode = createNode('body-1', WorkflowNodeType.IF_ELSE, 'If Node')

      const workflowWithConditional = {
        ...mockWorkflow,
        graph: {
          nodes: [],
          edges: [
            {
              id: 'e1',
              source: 'body-1',
              target: 'body-2',
              sourceHandle: 'true',
              targetHandle: 'target',
            },
            {
              id: 'e2',
              source: 'body-1',
              target: 'body-3',
              sourceHandle: 'false',
              targetHandle: 'target',
            },
          ],
        },
      }

      const result: NodeExecutionResult = {
        nodeId: 'body-1',
        status: NodeRunningStatus.Succeeded,
        output: {},
        outputHandle: 'true',
        executionTime: 50,
      }

      const nextNode = (manager as any).resolveNextNodeForLoop(
        bodyNode,
        result,
        'loop-1',
        workflowWithConditional
      )

      expect(nextNode).toBe('body-2')
    })
  })
})
