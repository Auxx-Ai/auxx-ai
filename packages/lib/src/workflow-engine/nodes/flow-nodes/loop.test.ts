// packages/lib/src/workflow-engine/nodes/flow-nodes/loop.test.ts

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { LoopProcessor } from './loop'
import { ExecutionContextManager } from '../../core/execution-context'
import { LoopContextManager } from '../../core/loop-context-extensions'
import { WorkflowNodeType, NodeRunningStatus } from '../../core/types'
import type { WorkflowNode } from '../../core/types'

// Mock the logger
vi.mock('@auxx/logger', () => ({
  createScopedLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

describe('LoopProcessor', () => {
  let loopProcessor: LoopProcessor
  let contextManager: ExecutionContextManager
  let mockNode: WorkflowNode

  beforeEach(() => {
    loopProcessor = new LoopProcessor()
    contextManager = new ExecutionContextManager('workflow-1', 'exec-1', 'org-1', 'user-1')

    // Initialize loop extensions
    LoopContextManager.initializeLoopExtensions(contextManager)

    // Set up test data
    contextManager.setVariable('items', ['apple', 'banana', 'orange'])
    contextManager.setVariable('numbers', [1, 2, 3, 4, 5])

    // Mock loop node with simplified config
    mockNode = {
      id: 'node-1',
      workflowId: 'workflow-1',
      nodeId: 'loop-1',
      type: WorkflowNodeType.LOOP,
      name: 'Test Loop',
      data: {
        title: 'Process Items',
        itemsSource: '{{items}}',
        maxIterations: 10,
        accumulateResults: true,
      },
      config: {
        title: 'Process Items',
        itemsSource: '{{items}}',
        maxIterations: 10,
        accumulateResults: true,
      },
      connections: {
        'loop-start': 'node-2',
        source: 'node-3',
      },
    }
  })

  describe('Basic Functionality', () => {
    it('should have correct type', () => {
      expect(loopProcessor.type).toBe(WorkflowNodeType.LOOP)
    })

    it('should validate configuration correctly', async () => {
      const validation = await loopProcessor.validate(mockNode)
      expect(validation.valid).toBe(true)
      expect(validation.errors).toHaveLength(0)
    })

    it('should fail validation without required fields', async () => {
      const invalidNode = {
        ...mockNode,
        data: {
          title: 'Invalid Loop',
        },
        config: {
          title: 'Invalid Loop',
        },
      }

      const validation = await loopProcessor.validate(invalidNode)
      expect(validation.valid).toBe(false)
      expect(validation.errors).toContain('Items source is required')
    })

    it('should fail validation with maxIterations <= 0', async () => {
      const invalidNode = {
        ...mockNode,
        data: {
          ...mockNode.data,
          maxIterations: 0,
        },
        config: {
          ...mockNode.config,
          maxIterations: 0,
        },
      }

      const validation = await loopProcessor.validate(invalidNode)
      expect(validation.valid).toBe(false)
      expect(validation.errors).toContain('Max iterations must be greater than 0')
    })
  })

  describe('Loop Execution', () => {
    it('should resolve items array from variable', async () => {
      // Mock the executeLoopBodyCallback
      ;(loopProcessor as any).executeLoopBodyCallback = vi
        .fn()
        .mockResolvedValue({ processed: true })

      const result = await loopProcessor.execute(mockNode, contextManager)

      expect(result.status).toBe(NodeRunningStatus.Succeeded)
      expect(result.output).toBeDefined()
      expect(result.output.totalIterations).toBe(3)
      expect(result.output.completedIterations).toBe(3)
      expect(result.output.results).toHaveLength(3)
    })

    it('should respect maxIterations limit', async () => {
      const nodeWithLimit = ({
        ...mockNode,
        config: {
          ...mockNode.config,
          itemsSource: '{{numbers}}',
          maxIterations: 3,
        },
      }(loopProcessor as any).executeLoopBodyCallback = vi
        .fn()
        .mockResolvedValue({ processed: true }))

      const result = await loopProcessor.execute(nodeWithLimit, contextManager)

      expect(result.output.totalIterations).toBe(3) // Limited to 3 despite 5 items
      expect(result.output.completedIterations).toBe(3)
    })

    it('should handle empty arrays', async () => {
      contextManager.setVariable('emptyArray', [])
      const nodeWithEmpty = {
        ...mockNode,
        config: {
          ...mockNode.config,
          itemsSource: '{{emptyArray}}',
        },
      }

      const result = await loopProcessor.execute(nodeWithEmpty, contextManager)

      expect(result.status).toBe(NodeRunningStatus.Succeeded)
      expect(result.output.totalIterations).toBe(0)
      expect(result.output.completedIterations).toBe(0)
    })

    it('should fail when items source is not an array', async () => {
      contextManager.setVariable('notArray', 'string value')
      const nodeWithInvalid = {
        ...mockNode,
        config: {
          ...mockNode.config,
          itemsSource: '{{notArray}}',
        },
      }

      await expect(loopProcessor.execute(nodeWithInvalid, contextManager)).rejects.toThrow(
        'Loop items source must be an array'
      )
    })

    it('should return source outputHandle when loop completes', async () => {
      ;(loopProcessor as any).executeLoopBodyCallback = vi
        .fn()
        .mockResolvedValue({ processed: true })

      const result = await loopProcessor.execute(mockNode, contextManager)

      expect(result.status).toBe(NodeRunningStatus.Succeeded)
      expect(result.outputHandle).toBe('source')
    })

    it('should return source outputHandle when loop breaks early', async () => {
      let iterationCount = 0
      ;(loopProcessor as any).executeLoopBodyCallback = vi
        .fn()
        .mockImplementation(() => {
          iterationCount++
          if (iterationCount === 2) {
            LoopContextManager.requestLoopBreak(contextManager, mockNode.nodeId)
          }
          return { processed: true }
        })

      const result = await loopProcessor.execute(mockNode, contextManager)

      expect(result.status).toBe(NodeRunningStatus.Succeeded)
      expect(result.outputHandle).toBe('source')
      expect(iterationCount).toBe(2)
    })
  })

  describe('Loop Variables', () => {
    it('should set loop variables correctly', async () => {
      const capturedVariables: any[] = ([](loopProcessor as any).executeLoopBodyCallback = vi
        .fn()
        .mockImplementation(() => {
          // Capture current loop variables
          capturedVariables.push({
            index: contextManager.getVariable('loop.index'),
            count: contextManager.getVariable('loop.count'),
            total: contextManager.getVariable('loop.total'),
            isFirst: contextManager.getVariable('loop.isFirst'),
            isLast: contextManager.getVariable('loop.isLast'),
            item: contextManager.getVariable('loop.item'),
            iterator: contextManager.getVariable('item'),
          })
          return { processed: true }
        }))

      await loopProcessor.execute(mockNode, contextManager)

      expect(capturedVariables).toHaveLength(3)

      // Check first iteration
      expect(capturedVariables[0]).toEqual({
        index: 0,
        count: 1,
        total: 3,
        isFirst: true,
        isLast: false,
        item: 'apple',
        iterator: 'apple',
      })

      // Check last iteration
      expect(capturedVariables[2]).toEqual({
        index: 2,
        count: 3,
        total: 3,
        isFirst: false,
        isLast: true,
        item: 'orange',
        iterator: 'orange',
      })
    })
  })

  describe('Error Handling', () => {
    it('should handle errors in loop body with continueOnError', async () => {
      const nodeWithErrorHandling = {
        ...mockNode,
        config: {
          ...mockNode.config,
          continueOnError: true,
          maxErrors: 5,
        },
      }

      let callCount = (0(loopProcessor as any).executeLoopBodyCallback = vi
        .fn()
        .mockImplementation(() => {
          callCount++
          if (callCount === 2) {
            throw new Error('Iteration 2 failed')
          }
          return { processed: true }
        }))

      const result = await loopProcessor.execute(nodeWithErrorHandling, contextManager)

      expect(result.status).toBe(NodeRunningStatus.Succeeded)
      expect(result.output.completedIterations).toBe(3)
      expect(result.output.errors).toBeDefined()
      expect(result.output.errors.totalErrors).toBe(1)
    })

    it('should stop on error without continueOnError', async () => {
      const nodeWithoutErrorHandling = ({
        ...mockNode,
        config: {
          ...mockNode.config,
          continueOnError: false,
        },
      }(loopProcessor as any).executeLoopBodyCallback = vi
        .fn()
        .mockResolvedValueOnce({ processed: true })
        .mockRejectedValueOnce(new Error('Iteration failed')))

      await expect(loopProcessor.execute(nodeWithoutErrorHandling, contextManager)).rejects.toThrow(
        'Iteration failed'
      )
    })

    it('should retry failed iterations when configured', async () => {
      const nodeWithRetry = {
        ...mockNode,
        config: {
          ...mockNode.config,
          continueOnError: true,
          retry: true,
          retryAttempts: 2,
        },
      }

      let attemptCount = (0(loopProcessor as any).executeLoopBodyCallback = vi
        .fn()
        .mockImplementation(() => {
          attemptCount++
          if (attemptCount === 2) {
            // Fail first time, succeed on retry
            if (attemptCount === 2) {
              throw new Error('Temporary failure')
            }
          }
          return { processed: true, attempt: attemptCount }
        }))

      const result = await loopProcessor.execute(nodeWithRetry, contextManager)

      expect(result.status).toBe(NodeRunningStatus.Succeeded)
      expect(attemptCount).toBeGreaterThan(3) // Should have retried
    })
  })

  describe('Progress Tracking', () => {
    it('should send progress updates when callback is provided', async () => {
      const progressUpdates: any[] =
        ([](loopProcessor as any).progressCallback =
        vi.fn().mockImplementation((update) => {
          progressUpdates.push(update)
        })(loopProcessor as any).executeLoopBodyCallback =
          vi.fn().mockResolvedValue({ processed: true }))

      await loopProcessor.execute(mockNode, contextManager)

      // Should have progress updates for each iteration plus completion
      expect(progressUpdates.length).toBeGreaterThan(3)

      // Check progress update structure
      const firstUpdate = progressUpdates[0]
      expect(firstUpdate.type).toBe('loop_progress')
      expect(firstUpdate.progress.currentIteration).toBe(0)
      expect(firstUpdate.progress.totalIterations).toBe(3)
      expect(firstUpdate.progress.percentComplete).toBe(33)

      // Check completion update
      const lastUpdate = progressUpdates[progressUpdates.length - 1]
      expect(lastUpdate.progress.status).toBe('completed')
      expect(lastUpdate.progress.percentComplete).toBe(100)
    })
  })

  describe('Memory Management', () => {
    it('should handle large arrays with throttling', async () => {
      // Create a large array
      const largeArray = Array.from({ length: 100 }, (_, i) => i)
      contextManager.setVariable('largeArray', largeArray)

      const nodeWithLargeArray = ({
        ...mockNode,
        config: {
          ...mockNode.config,
          itemsSource: '{{largeArray}}',
          maxIterations: 100,
        },
      }(loopProcessor as any).executeLoopBodyCallback = vi
        .fn()
        .mockResolvedValue({ processed: true }))

      const startTime = Date.now()
      const result = await loopProcessor.execute(nodeWithLargeArray, contextManager)
      const duration = Date.now() - startTime

      expect(result.status).toBe(NodeRunningStatus.Succeeded)
      expect(result.output.totalIterations).toBe(100)

      // Should have some throttling delays
      expect(duration).toBeGreaterThan(50) // At least some throttling occurred
    })
  })

  describe('Loop Break', () => {
    it('should break loop when requested', async () => {
      let iterationCount = (0(loopProcessor as any).executeLoopBodyCallback = vi
        .fn()
        .mockImplementation(() => {
          iterationCount++
          if (iterationCount === 2) {
            // Request break after second iteration
            LoopContextManager.requestLoopBreak(contextManager, mockNode.nodeId)
          }
          return { processed: true }
        }))

      const result = await loopProcessor.execute(mockNode, contextManager)

      expect(result.status).toBe(NodeRunningStatus.Succeeded)
      expect(iterationCount).toBe(2) // Should stop at 2, not process all 3
    })
  })
})
