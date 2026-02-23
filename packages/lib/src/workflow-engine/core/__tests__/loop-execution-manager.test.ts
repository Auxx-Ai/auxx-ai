// packages/lib/src/workflow-engine/core/__tests__/loop-execution-manager.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ExecutionContextManager } from '../execution-context'
import { LoopExecutionManager } from '../loop-execution-manager'
import type {
  NodeExecutionResult,
  Workflow,
  WorkflowExecutionOptions,
  WorkflowNode,
} from '../types'
import { NodeRunningStatus, WorkflowNodeType } from '../types'

describe('LoopExecutionManager', () => {
  let manager: LoopExecutionManager
  let executeNodeCallback: ReturnType<typeof vi.fn>
  let contextManager: ExecutionContextManager
  let mockWorkflow: Workflow

  beforeEach(() => {
    executeNodeCallback = vi.fn()
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
      name: 'Test Workflow',
      organizationId: 'org-1',
      nodes: [],
      graph: {
        nodes: [],
        edges: [],
      },
    } as Workflow
  })

  describe('setupLoopExecution', () => {
    it('should inject executeLoopBodyCallback into processor', async () => {
      const loopNode: WorkflowNode = {
        nodeId: 'loop-1',
        type: WorkflowNodeType.LOOP,
        name: 'Test Loop',
        data: {},
        position: { x: 0, y: 0 },
      }

      let capturedCallback: any
      const mockProcessor = {
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
      const loopNode: WorkflowNode = {
        nodeId: 'loop-1',
        type: WorkflowNodeType.LOOP,
        name: 'Test Loop',
        data: {},
        position: { x: 0, y: 0 },
      }

      let capturedProgressCallback: any
      const mockProcessor = {
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
      const loopNode: WorkflowNode = {
        nodeId: 'loop-1',
        type: WorkflowNodeType.LOOP,
        name: 'Test Loop',
        data: {},
        position: { x: 0, y: 0 },
      }

      const mockProcessor = {
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
      const loopNode: WorkflowNode = {
        nodeId: 'loop-1',
        type: WorkflowNodeType.LOOP,
        name: 'Test Loop',
        data: {},
        position: { x: 0, y: 0 },
      }

      const mockProcessor = {
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
      const loopNode: WorkflowNode = {
        nodeId: 'loop-1',
        type: WorkflowNodeType.LOOP,
        name: 'Test Loop',
        data: {},
        position: { x: 0, y: 0 },
      }

      let capturedProgressCallback: any
      const mockProcessor = {
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
      const loopNode: WorkflowNode = {
        nodeId: 'loop-1',
        type: WorkflowNodeType.LOOP,
        name: 'Test Loop',
        data: {},
        position: { x: 0, y: 0 },
      }

      const workflowNoEdges = {
        ...mockWorkflow,
        graph: undefined,
      } as Workflow

      const mockProcessor = {
        preprocessNode: vi.fn().mockResolvedValue({}),
        execute: vi.fn().mockImplementation(async () => {
          // Call the callback
          return await mockProcessor.executeLoopBodyCallback(loopNode, contextManager)
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
      const loopNode: WorkflowNode = {
        nodeId: 'loop-1',
        type: WorkflowNodeType.LOOP,
        name: 'Test Loop',
        data: {},
        position: { x: 0, y: 0 },
      }

      const workflowNoStart = {
        ...mockWorkflow,
        graph: {
          nodes: [],
          edges: [], // No edges = no loop-start connection
        },
      } as Workflow

      let result: any
      const mockProcessor = {
        preprocessNode: vi.fn().mockResolvedValue({}),
        execute: vi.fn().mockImplementation(async () => {
          // Call the callback and capture result
          result = await mockProcessor.executeLoopBodyCallback(loopNode, contextManager)
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
      const loopNode: WorkflowNode = {
        nodeId: 'loop-1',
        type: WorkflowNodeType.LOOP,
        name: 'Test Loop',
        data: {},
        position: { x: 0, y: 0 },
      }

      const bodyNode: WorkflowNode = {
        nodeId: 'body-1',
        type: WorkflowNodeType.CODE,
        name: 'Body Node',
        data: {},
        position: { x: 0, y: 0 },
      }

      // Need end node that connects back to loop (has loop-back edge)
      const endNode: WorkflowNode = {
        nodeId: 'end-1',
        type: WorkflowNodeType.END,
        name: 'End Node',
        data: {},
        position: { x: 0, y: 0 },
      }

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
      } as Workflow

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
      const mockProcessor = {
        preprocessNode: vi.fn().mockResolvedValue({}),
        execute: vi.fn().mockImplementation(async () => {
          result = await mockProcessor.executeLoopBodyCallback(loopNode, contextManager)
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

      // Verify executeNodeCallback was called for body node (end node has loop-back so stops before executing it)
      expect(executeNodeCallback).toHaveBeenCalledWith(bodyNode, contextManager, options)
      expect(executeNodeCallback).toHaveBeenCalledTimes(1)

      // Verify result contains the output from last executed node
      expect(result).toEqual({ result: 'success', nodeId: 'body-1' })
    })
  })

  describe('executeLoopBodyNodes', () => {
    it('should stop at loop-back connection', async () => {
      const loopNode: WorkflowNode = {
        nodeId: 'loop-1',
        type: WorkflowNodeType.LOOP,
        name: 'Test Loop',
        data: {},
        position: { x: 0, y: 0 },
      }

      const bodyNode1: WorkflowNode = {
        nodeId: 'body-1',
        type: WorkflowNodeType.CODE,
        name: 'Body Node 1',
        data: {},
        position: { x: 0, y: 0 },
      }

      const bodyNode2: WorkflowNode = {
        nodeId: 'body-2',
        type: WorkflowNodeType.CODE,
        name: 'Body Node 2',
        data: {},
        position: { x: 0, y: 0 },
      }

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
      } as Workflow

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
      const mockProcessor = {
        preprocessNode: vi.fn().mockResolvedValue({}),
        execute: vi.fn().mockImplementation(async () => {
          result = await mockProcessor.executeLoopBodyCallback(loopNode, contextManager)
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
      // body-1 executes, then moves to body-2
      // body-2 is checked for loop-back BEFORE execution, finds loop-back, stops
      // So only body-1 executes
      expect(callCount).toBe(1)
      expect(executeNodeCallback).toHaveBeenCalledTimes(1)
      expect(executeNodeCallback).toHaveBeenCalledWith(bodyNode1, contextManager, options)
    })

    it('should detect cycles within loop body', async () => {
      const loopNode: WorkflowNode = {
        nodeId: 'loop-1',
        type: WorkflowNodeType.LOOP,
        name: 'Test Loop',
        data: {},
        position: { x: 0, y: 0 },
      }

      const bodyNode: WorkflowNode = {
        nodeId: 'body-1',
        type: WorkflowNodeType.CODE,
        name: 'Body Node',
        data: {},
        position: { x: 0, y: 0 },
      }

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
      } as Workflow

      executeNodeCallback.mockResolvedValue({
        nodeId: 'body-1',
        status: NodeRunningStatus.Succeeded,
        output: { result: 'success' },
        executionTime: 50,
      })

      const mockProcessor = {
        preprocessNode: vi.fn().mockResolvedValue({}),
        execute: vi.fn().mockImplementation(async () => {
          return await mockProcessor.executeLoopBodyCallback(loopNode, contextManager)
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
      const loopNode: WorkflowNode = {
        nodeId: 'loop-1',
        type: WorkflowNodeType.LOOP,
        name: 'Test Loop',
        data: {},
        position: { x: 0, y: 0 },
      }

      const bodyNode: WorkflowNode = {
        nodeId: 'body-1',
        type: WorkflowNodeType.CODE,
        name: 'Body Node',
        data: {},
        position: { x: 0, y: 0 },
      }

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
      } as Workflow

      // Mock node failure
      executeNodeCallback.mockResolvedValue({
        nodeId: 'body-1',
        status: NodeRunningStatus.Failed,
        error: 'Node execution failed',
        executionTime: 50,
      })

      const mockProcessor = {
        preprocessNode: vi.fn().mockResolvedValue({}),
        execute: vi.fn().mockImplementation(async () => {
          return await mockProcessor.executeLoopBodyCallback(loopNode, contextManager)
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
  })

  describe('isLoopBackConnection', () => {
    it('should return true for loop-back edges', () => {
      const bodyNode: WorkflowNode = {
        nodeId: 'body-1',
        type: WorkflowNodeType.CODE,
        name: 'Body Node',
        data: {},
        position: { x: 0, y: 0 },
      }

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
      } as Workflow

      // Access private method via any cast for testing
      const isLoopBack = (manager as any).isLoopBackConnection(
        bodyNode,
        'loop-1',
        workflowWithLoopBack
      )

      expect(isLoopBack).toBe(true)
    })

    it('should return false for non-loop-back edges', () => {
      const bodyNode: WorkflowNode = {
        nodeId: 'body-1',
        type: WorkflowNodeType.CODE,
        name: 'Body Node',
        data: {},
        position: { x: 0, y: 0 },
      }

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
      } as Workflow

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
      const bodyNode: WorkflowNode = {
        nodeId: 'body-1',
        type: WorkflowNodeType.CODE,
        name: 'Body Node',
        data: {},
        position: { x: 0, y: 0 },
      }

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
      } as Workflow

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
      const bodyNode: WorkflowNode = {
        nodeId: 'body-1',
        type: WorkflowNodeType.CODE,
        name: 'Body Node',
        data: {},
        position: { x: 0, y: 0 },
      }

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
      } as Workflow

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
      const bodyNode: WorkflowNode = {
        nodeId: 'body-1',
        type: WorkflowNodeType.IF_ELSE,
        name: 'If Node',
        data: {},
        position: { x: 0, y: 0 },
      }

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
      } as Workflow

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
