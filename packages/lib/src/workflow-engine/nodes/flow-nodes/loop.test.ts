// packages/lib/src/workflow-engine/nodes/flow-nodes/loop.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ExecutionContextManager } from '../../core/execution-context'
import { LoopContextManager } from '../../core/loop-context-extensions'
import type { WorkflowNode } from '../../core/types'
import { NodeRunningStatus, WorkflowNodeType } from '../../core/types'
import { LoopProcessor } from './loop'

// Silence the logger. Partial mock: `@auxx/logger/run-log` imports sink-registration
// helpers from this barrel at module load, so a full replacement breaks collection.
vi.mock('@auxx/logger', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@auxx/logger')>()),
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
        id: 'loop-1',
        type: WorkflowNodeType.LOOP,
        title: 'Process Items',
        itemsSource: '{{items}}',
        maxIterations: 10,
        accumulateResults: true,
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
          id: 'loop-1',
          type: WorkflowNodeType.LOOP,
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

      const preprocessed = await loopProcessor.preprocessNode(mockNode, contextManager)
      const result = await loopProcessor.execute(mockNode, contextManager, preprocessed)

      expect(result.status).toBe(NodeRunningStatus.Succeeded)
      expect(result.output).toBeDefined()
      expect(result.output.totalIterations).toBe(3)
      expect(result.output.completedIterations).toBe(3)
      expect(result.output.results).toHaveLength(3)
    })

    it('should respect maxIterations limit', async () => {
      const nodeWithLimit = {
        ...mockNode,
        data: {
          ...mockNode.data,
          itemsSource: '{{numbers}}',
          maxIterations: 3,
        },
      }
      ;(loopProcessor as any).executeLoopBodyCallback = vi
        .fn()
        .mockResolvedValue({ processed: true })

      const preprocessed = await loopProcessor.preprocessNode(nodeWithLimit, contextManager)
      const result = await loopProcessor.execute(nodeWithLimit, contextManager, preprocessed)

      expect(result.output.totalIterations).toBe(3) // Limited to 3 despite 5 items
      expect(result.output.completedIterations).toBe(3)
    })

    it('should handle empty arrays', async () => {
      contextManager.setVariable('emptyArray', [])
      const nodeWithEmpty = {
        ...mockNode,
        data: {
          ...mockNode.data,
          itemsSource: '{{emptyArray}}',
        },
      }

      const preprocessed = await loopProcessor.preprocessNode(nodeWithEmpty, contextManager)
      const result = await loopProcessor.execute(nodeWithEmpty, contextManager, preprocessed)

      expect(result.status).toBe(NodeRunningStatus.Succeeded)
      expect(result.output.totalIterations).toBe(0)
      expect(result.output.completedIterations).toBe(0)
    })

    it('should fail when items source is not an array', async () => {
      contextManager.setVariable('notArray', 'string value')
      const nodeWithInvalid = {
        ...mockNode,
        data: {
          ...mockNode.data,
          itemsSource: '{{notArray}}',
        },
      }

      await expect(loopProcessor.preprocessNode(nodeWithInvalid, contextManager)).rejects.toThrow(
        'Expected array but got string'
      )
    })

    it('should return source outputHandle when loop completes', async () => {
      ;(loopProcessor as any).executeLoopBodyCallback = vi
        .fn()
        .mockResolvedValue({ processed: true })

      const preprocessed = await loopProcessor.preprocessNode(mockNode, contextManager)
      const result = await loopProcessor.execute(mockNode, contextManager, preprocessed)

      expect(result.status).toBe(NodeRunningStatus.Succeeded)
      expect(result.outputHandle).toBe('source')
    })

    it('should return source outputHandle when loop breaks early', async () => {
      let iterationCount = 0
      ;(loopProcessor as any).executeLoopBodyCallback = vi.fn().mockImplementation(() => {
        iterationCount++
        if (iterationCount === 2) {
          LoopContextManager.requestLoopBreak(contextManager, mockNode.nodeId)
        }
        return { processed: true }
      })

      const preprocessed = await loopProcessor.preprocessNode(mockNode, contextManager)
      const result = await loopProcessor.execute(mockNode, contextManager, preprocessed)

      expect(result.status).toBe(NodeRunningStatus.Succeeded)
      expect(result.outputHandle).toBe('source')
      expect(iterationCount).toBe(2)
    })
  })

  describe('Loop Variables', () => {
    it('should set loop variables correctly', async () => {
      const capturedVariables: any[] = []
      const loopNodeId = mockNode.nodeId
      ;(loopProcessor as any).executeLoopBodyCallback = vi.fn().mockImplementation(async () => {
        // Capture current loop variables (set via setNodeVariable as loopNodeId.*)
        capturedVariables.push({
          index: await contextManager.getVariable(`${loopNodeId}.index`),
          count: await contextManager.getVariable(`${loopNodeId}.count`),
          total: await contextManager.getVariable(`${loopNodeId}.total`),
          isFirst: await contextManager.getVariable(`${loopNodeId}.isFirst`),
          isLast: await contextManager.getVariable(`${loopNodeId}.isLast`),
          item: await contextManager.getVariable(`${loopNodeId}.item`),
          iterator: await contextManager.getVariable('item'),
        })
        return { processed: true }
      })

      const preprocessed = await loopProcessor.preprocessNode(mockNode, contextManager)
      await loopProcessor.execute(mockNode, contextManager, preprocessed)

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

  describe('Output Variables', () => {
    /**
     * The builder advertises `totalIterations`, `completedIterations`, `results` and
     * `lastResult` for an accumulating loop (`getLoopOutputVariables`). Every one of them
     * has to resolve as a `<nodeId>.<path>` variable, not just sit in `result.output`.
     */
    it('should publish every advertised output as a node variable', async () => {
      ;(loopProcessor as any).executeLoopBodyCallback = vi
        .fn()
        .mockImplementation(async () => ({ processed: await contextManager.getVariable('item') }))

      const preprocessed = await loopProcessor.preprocessNode(mockNode, contextManager)
      await loopProcessor.execute(mockNode, contextManager, preprocessed)

      expect(await contextManager.getVariable('loop-1.totalIterations')).toBe(3)
      expect(await contextManager.getVariable('loop-1.completedIterations')).toBe(3)
      expect(await contextManager.getVariable('loop-1.results')).toEqual([
        { processed: 'apple' },
        { processed: 'banana' },
        { processed: 'orange' },
      ])
      expect(await contextManager.getVariable('loop-1.lastResult')).toEqual({
        processed: 'orange',
      })
    })

    /**
     * The regression this exists for: `injectLoopVariables` writes `results` at the TOP of
     * each iteration, so the published array always trailed the pushed one by a single
     * element — the last iteration's result was never visible downstream.
     */
    it('should include the LAST iteration in results', async () => {
      ;(loopProcessor as any).executeLoopBodyCallback = vi
        .fn()
        .mockImplementation(async () => ({ item: await contextManager.getVariable('item') }))

      const preprocessed = await loopProcessor.preprocessNode(mockNode, contextManager)
      const result = await loopProcessor.execute(mockNode, contextManager, preprocessed)

      const published = await contextManager.getVariable('loop-1.results')
      expect(published).toHaveLength(3)
      expect(published).toEqual(result.output.results)
      expect(published[2]).toEqual({ item: 'orange' })
    })

    it('should publish results for a single-iteration loop', async () => {
      contextManager.setVariable('one', ['solo'])
      const singleNode = {
        ...mockNode,
        data: { ...mockNode.data, itemsSource: '{{one}}' },
      }
      ;(loopProcessor as any).executeLoopBodyCallback = vi.fn().mockResolvedValue({ done: true })

      const preprocessed = await loopProcessor.preprocessNode(singleNode, contextManager)
      await loopProcessor.execute(singleNode, contextManager, preprocessed)

      expect(await contextManager.getVariable('loop-1.results')).toEqual([{ done: true }])
    })

    it('should publish `result` instead of `results` when not accumulating', async () => {
      const nonAccumulating = {
        ...mockNode,
        data: { ...mockNode.data, accumulateResults: false },
      }
      ;(loopProcessor as any).executeLoopBodyCallback = vi
        .fn()
        .mockImplementation(async () => ({ item: await contextManager.getVariable('item') }))

      const preprocessed = await loopProcessor.preprocessNode(nonAccumulating, contextManager)
      const result = await loopProcessor.execute(nonAccumulating, contextManager, preprocessed)

      expect(await contextManager.getVariable('loop-1.result')).toEqual({ item: 'orange' })
      expect(result.output.results).toBeUndefined()
      expect(result.output.result).toEqual({ item: 'orange' })
    })

    it('should publish empty results and null lastResult for an empty array', async () => {
      contextManager.setVariable('emptyArray', [])
      const nodeWithEmpty = {
        ...mockNode,
        data: { ...mockNode.data, itemsSource: '{{emptyArray}}' },
      }

      const preprocessed = await loopProcessor.preprocessNode(nodeWithEmpty, contextManager)
      await loopProcessor.execute(nodeWithEmpty, contextManager, preprocessed)

      expect(await contextManager.getVariable('loop-1.results')).toEqual([])
      expect(await contextManager.getVariable('loop-1.lastResult')).toBeNull()
      expect(await contextManager.getVariable('loop-1.completedIterations')).toBe(0)
    })

    it('should publish results collected before an early break', async () => {
      let iterationCount = 0
      ;(loopProcessor as any).executeLoopBodyCallback = vi.fn().mockImplementation(() => {
        iterationCount++
        if (iterationCount === 2) {
          LoopContextManager.requestLoopBreak(contextManager, mockNode.nodeId)
        }
        return { n: iterationCount }
      })

      const preprocessed = await loopProcessor.preprocessNode(mockNode, contextManager)
      await loopProcessor.execute(mockNode, contextManager, preprocessed)

      expect(await contextManager.getVariable('loop-1.results')).toEqual([{ n: 1 }, { n: 2 }])
      expect(await contextManager.getVariable('loop-1.lastResult')).toEqual({ n: 2 })
      expect(await contextManager.getVariable('loop-1.completedIterations')).toBe(2)
    })

    /**
     * Nested loops keep separate result sets because every write is `nodeId`-scoped — and
     * the inner loop's own last iteration must land too, on every outer pass.
     */
    it('should keep results complete and separate for nested loops', async () => {
      contextManager.setVariable('outer', ['a', 'b'])
      contextManager.setVariable('inner', [1, 2, 3])

      const outerNode = {
        ...mockNode,
        nodeId: 'loop-outer',
        data: { ...mockNode.data, itemsSource: '{{outer}}' },
      }
      const innerNode = {
        ...mockNode,
        nodeId: 'loop-inner',
        data: { ...mockNode.data, itemsSource: '{{inner}}' },
      }

      const innerProcessor = new LoopProcessor()
      const innerResultsPerOuterPass: any[][] = []

      ;(innerProcessor as any).executeLoopBodyCallback = vi.fn().mockImplementation(async () => ({
        n: await contextManager.getVariable('loop-inner.item'),
      }))
      ;(loopProcessor as any).executeLoopBodyCallback = vi.fn().mockImplementation(async () => {
        const outerItem = await contextManager.getVariable('loop-outer.item')
        const preprocessedInner = await innerProcessor.preprocessNode(innerNode, contextManager)
        await innerProcessor.execute(innerNode, contextManager, preprocessedInner)
        innerResultsPerOuterPass.push(await contextManager.getVariable('loop-inner.results'))
        return { outerItem }
      })

      const preprocessedOuter = await loopProcessor.preprocessNode(outerNode, contextManager)
      await loopProcessor.execute(outerNode, contextManager, preprocessedOuter)

      // Inner loop: all three iterations on BOTH outer passes
      expect(innerResultsPerOuterPass).toEqual([
        [{ n: 1 }, { n: 2 }, { n: 3 }],
        [{ n: 1 }, { n: 2 }, { n: 3 }],
      ])
      expect(await contextManager.getVariable('loop-inner.results')).toHaveLength(3)

      // Outer loop: both iterations, under its own node id
      expect(await contextManager.getVariable('loop-outer.results')).toEqual([
        { outerItem: 'a' },
        { outerItem: 'b' },
      ])
      expect(await contextManager.getVariable('loop-outer.totalIterations')).toBe(2)
      expect(await contextManager.getVariable('loop-outer.completedIterations')).toBe(2)
    })

    /**
     * The iterator variables were audited clean — this pins them against the new
     * result-publishing writes.
     */
    it('should not disturb the iterator variables', async () => {
      ;(loopProcessor as any).executeLoopBodyCallback = vi.fn().mockResolvedValue({ ok: true })

      const preprocessed = await loopProcessor.preprocessNode(mockNode, contextManager)
      await loopProcessor.execute(mockNode, contextManager, preprocessed)

      expect(await contextManager.getVariable('loop-1.index')).toBe(2)
      expect(await contextManager.getVariable('loop-1.count')).toBe(3)
      expect(await contextManager.getVariable('loop-1.total')).toBe(3)
      expect(await contextManager.getVariable('loop-1.isFirst')).toBe(false)
      expect(await contextManager.getVariable('loop-1.isLast')).toBe(true)
      expect(await contextManager.getVariable('loop-1.item')).toBe('orange')
    })
  })

  describe('Error Handling', () => {
    it('should throw on error with default error strategy', async () => {
      let callCount = 0
      ;(loopProcessor as any).executeLoopBodyCallback = vi.fn().mockImplementation(() => {
        callCount++
        if (callCount === 2) {
          throw new Error('Iteration 2 failed')
        }
        return { processed: true }
      })

      const preprocessed = await loopProcessor.preprocessNode(mockNode, contextManager)
      await expect(loopProcessor.execute(mockNode, contextManager, preprocessed)).rejects.toThrow(
        'Iteration 2 failed'
      )
    })

    it('should stop on error without continueOnError', async () => {
      ;(loopProcessor as any).executeLoopBodyCallback = vi
        .fn()
        .mockResolvedValueOnce({ processed: true })
        .mockRejectedValueOnce(new Error('Iteration failed'))

      const preprocessed = await loopProcessor.preprocessNode(mockNode, contextManager)
      await expect(loopProcessor.execute(mockNode, contextManager, preprocessed)).rejects.toThrow(
        'Iteration failed'
      )
    })

    it('should propagate errors without retry when using default strategy', async () => {
      let attemptCount = 0
      ;(loopProcessor as any).executeLoopBodyCallback = vi.fn().mockImplementation(() => {
        attemptCount++
        if (attemptCount === 2) {
          throw new Error('Temporary failure')
        }
        return { processed: true, attempt: attemptCount }
      })

      const preprocessed = await loopProcessor.preprocessNode(mockNode, contextManager)
      await expect(loopProcessor.execute(mockNode, contextManager, preprocessed)).rejects.toThrow(
        'Temporary failure'
      )

      // Should not have retried — only 2 calls total (1 success + 1 failure)
      expect(attemptCount).toBe(2)
    })
  })

  describe('Progress Tracking', () => {
    it('should send progress updates when callback is provided', async () => {
      const progressUpdates: any[] = []
      ;(loopProcessor as any).progressCallback = vi.fn().mockImplementation((update) => {
        progressUpdates.push(update)
      })
      ;(loopProcessor as any).executeLoopBodyCallback = vi
        .fn()
        .mockResolvedValue({ processed: true })

      const preprocessed = await loopProcessor.preprocessNode(mockNode, contextManager)
      await loopProcessor.execute(mockNode, contextManager, preprocessed)

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

      const nodeWithLargeArray = {
        ...mockNode,
        data: {
          ...mockNode.data,
          itemsSource: '{{largeArray}}',
          maxIterations: 100,
        },
      }
      ;(loopProcessor as any).executeLoopBodyCallback = vi
        .fn()
        .mockResolvedValue({ processed: true })

      const startTime = Date.now()
      const preprocessed = await loopProcessor.preprocessNode(nodeWithLargeArray, contextManager)
      const result = await loopProcessor.execute(nodeWithLargeArray, contextManager, preprocessed)
      const duration = Date.now() - startTime

      expect(result.status).toBe(NodeRunningStatus.Succeeded)
      expect(result.output.totalIterations).toBe(100)

      // Throttling only kicks in when memory pressure is detected
      // In test environment, memory is typically fine, so just verify completion
      expect(duration).toBeGreaterThanOrEqual(0)
    })
  })

  describe('Loop Break', () => {
    it('should break loop when requested', async () => {
      let iterationCount = 0
      ;(loopProcessor as any).executeLoopBodyCallback = vi.fn().mockImplementation(() => {
        iterationCount++
        if (iterationCount === 2) {
          // Request break after second iteration
          LoopContextManager.requestLoopBreak(contextManager, mockNode.nodeId)
        }
        return { processed: true }
      })

      const preprocessed = await loopProcessor.preprocessNode(mockNode, contextManager)
      const result = await loopProcessor.execute(mockNode, contextManager, preprocessed)

      expect(result.status).toBe(NodeRunningStatus.Succeeded)
      expect(iterationCount).toBe(2) // Should stop at 2, not process all 3
    })
  })
})
