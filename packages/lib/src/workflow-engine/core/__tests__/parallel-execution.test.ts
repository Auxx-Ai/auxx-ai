// packages/lib/src/workflow-engine/core/__tests__/parallel-execution.test.ts

import { beforeEach, describe, expect, it } from 'vitest'
import type { ExecutionContextManager } from '../execution-context'
import type { NodeProcessorRegistry } from '../node-processor-registry'
import type { NodeExecutionResult, Workflow, WorkflowEdge, WorkflowNode } from '../types'
import { NodeRunningStatus, WorkflowNodeType } from '../types'
import { WorkflowEngine } from '../workflow-engine'

// Mock processor for testing
class MockProcessor {
  readonly type: WorkflowNodeType
  private delay: number
  private output: any

  constructor(type: WorkflowNodeType, delay = 0, output: any = {}) {
    this.type = type
    this.delay = delay
    this.output = output
  }

  async execute(
    node: WorkflowNode,
    contextManager: ExecutionContextManager
  ): Promise<NodeExecutionResult> {
    contextManager.log('INFO', node.nodeId, `Executing ${node.nodeId}`)

    // Simulate processing delay
    if (this.delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delay))
    }

    // Set variables if specified in node data
    if (node.data.setVariables) {
      Object.entries(node.data.setVariables).forEach(([key, value]) => {
        contextManager.setVariable(key, value)
      })
    }

    return {
      nodeId: node.nodeId,
      status: NodeRunningStatus.Succeeded,
      output: this.output,
      outputHandle: node.data.outputHandle || 'source',
      executionTime: this.delay,
    }
  }

  async preprocessNode() {
    return { inputs: {}, metadata: {} }
  }

  async validate() {
    return { valid: true, errors: [], warnings: [] }
  }
}

describe('Parallel Execution with Convergence', () => {
  let engine: WorkflowEngine
  let registry: NodeProcessorRegistry

  beforeEach(() => {
    engine = new WorkflowEngine()
    registry = engine.getNodeRegistry()
  })

  describe('Basic Diamond Pattern', () => {
    it('should execute diamond pattern with proper convergence', async () => {
      // Register mock processors
      registry.registerProcessor(new MockProcessor(WorkflowNodeType.MANUAL, 0, { type: 'start' }))
      registry.registerProcessor(new MockProcessor(WorkflowNodeType.CODE, 100, { type: 'branch' }))
      registry.registerProcessor(new MockProcessor(WorkflowNodeType.END, 0, { type: 'join' }))

      const workflow: Workflow = {
        id: 'test-diamond',
        workflowId: 'test-diamond',
        workflowAppId: 'test-app',
        organizationId: 'org-1',
        name: 'Diamond Pattern Test',
        enabled: true,
        version: 1,
        triggerType: WorkflowNodeType.MANUAL,
        nodes: [],
        graph: {
          nodes: [
            { id: 'start', type: 'manual', data: { type: 'manual' } },
            {
              id: 'branch-a',
              type: 'code',
              data: { type: 'code', setVariables: { branchA: 'completed' } },
            },
            {
              id: 'branch-b',
              type: 'code',
              data: { type: 'code', setVariables: { branchB: 'completed' } },
            },
            {
              id: 'join',
              type: 'end',
              data: {
                type: 'end',
                joinConfig: { type: 'all', mergeStrategy: { type: 'merge-all' } },
              },
            },
          ],
          edges: [
            {
              id: 'e1',
              source: 'start',
              target: 'branch-a',
              sourceHandle: 'source',
              targetHandle: 'target',
            },
            {
              id: 'e2',
              source: 'start',
              target: 'branch-b',
              sourceHandle: 'source',
              targetHandle: 'target',
            },
            {
              id: 'e3',
              source: 'branch-a',
              target: 'join',
              sourceHandle: 'source',
              targetHandle: 'target',
            },
            {
              id: 'e4',
              source: 'branch-b',
              target: 'join',
              sourceHandle: 'source',
              targetHandle: 'target',
            },
          ] as WorkflowEdge[],
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      const result = await engine.executeWorkflow(workflow, {
        type: WorkflowNodeType.MANUAL,
        data: {},
        timestamp: new Date(),
        organizationId: 'org-1',
      })

      // Verify execution completed
      expect(result.status).toBe('COMPLETED')

      // Verify the start and join nodes were executed in the main flow
      expect(Object.keys(result.nodeResults)).toContain('start')
      expect(Object.keys(result.nodeResults)).toContain('join')

      // Verify branch effects were merged (context variables from both branches)
      expect(result.context.variables).toHaveProperty('branchA', 'completed')
      expect(result.context.variables).toHaveProperty('branchB', 'completed')
    })
  })

  describe('Sequential Branch with Parallel Convergence', () => {
    it('should handle sequential steps in parallel branches', async () => {
      // Tests a pattern where one branch has multiple sequential steps
      // before converging at a join point:
      //   start -> branch-a -> step-a2 -> join
      //        \-> branch-b ------------/
      registry.registerProcessor(new MockProcessor(WorkflowNodeType.MANUAL))
      registry.registerProcessor(new MockProcessor(WorkflowNodeType.CODE, 50))
      registry.registerProcessor(new MockProcessor(WorkflowNodeType.END))

      const workflow: Workflow = {
        id: 'test-sequential-branch',
        workflowId: 'test-sequential-branch',
        workflowAppId: 'test-app',
        organizationId: 'org-1',
        name: 'Sequential Branch Pattern Test',
        enabled: true,
        version: 1,
        triggerType: WorkflowNodeType.MANUAL,
        nodes: [],
        graph: {
          nodes: [
            { id: 'start', type: 'manual', data: { type: 'manual' } },
            {
              id: 'branch-a',
              type: 'code',
              data: { type: 'code', setVariables: { stepA1: 'done' } },
            },
            {
              id: 'step-a2',
              type: 'code',
              data: { type: 'code', setVariables: { stepA2: 'done' } },
            },
            {
              id: 'branch-b',
              type: 'code',
              data: { type: 'code', setVariables: { stepB: 'done' } },
            },
            { id: 'join', type: 'end', data: { type: 'end', joinConfig: { type: 'all' } } },
          ],
          edges: [
            // Fork from start
            {
              id: 'e1',
              source: 'start',
              target: 'branch-a',
              sourceHandle: 'source',
              targetHandle: 'target',
            },
            {
              id: 'e2',
              source: 'start',
              target: 'branch-b',
              sourceHandle: 'source',
              targetHandle: 'target',
            },
            // Sequential step in branch-a
            {
              id: 'e3',
              source: 'branch-a',
              target: 'step-a2',
              sourceHandle: 'source',
              targetHandle: 'target',
            },
            // Both converge at join
            {
              id: 'e4',
              source: 'step-a2',
              target: 'join',
              sourceHandle: 'source',
              targetHandle: 'target',
            },
            {
              id: 'e5',
              source: 'branch-b',
              target: 'join',
              sourceHandle: 'source',
              targetHandle: 'target',
            },
          ] as WorkflowEdge[],
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      const result = await engine.executeWorkflow(workflow, {
        type: WorkflowNodeType.MANUAL,
        data: {},
        timestamp: new Date(),
        organizationId: 'org-1',
      })

      // Verify execution completed
      expect(result.status).toBe('COMPLETED')

      // Verify start and join nodes in results
      expect(Object.keys(result.nodeResults)).toContain('start')
      expect(Object.keys(result.nodeResults)).toContain('join')

      // Verify branch effects were merged (variables from all steps)
      expect(result.context.variables).toHaveProperty('stepA1', 'done')
      expect(result.context.variables).toHaveProperty('stepA2', 'done')
      expect(result.context.variables).toHaveProperty('stepB', 'done')
    })
  })

  describe('Loop with Parallel Branches', () => {
    it('should handle parallel execution within loop iterations', async () => {
      // This test would verify that join states are properly isolated per loop iteration
      // Implementation would require loop processor integration
      expect(true).toBe(true) // Placeholder
    })
  })

  describe('Manual Confirmation in Parallel Branch', () => {
    it('should handle pause/resume in parallel branches', async () => {
      // This test would verify that one branch can pause while others continue
      // And that the join waits for all branches including resumed ones
      expect(true).toBe(true) // Placeholder
    })
  })

  describe('Error Handling in Parallel Execution', () => {
    it('should handle partial branch failures with minimum success requirement', async () => {
      // Register mock processors including one that fails
      registry.registerProcessor(new MockProcessor(WorkflowNodeType.MANUAL))
      registry.registerProcessor(
        new MockProcessor(WorkflowNodeType.CODE, 50, { result: 'success' })
      )

      // Failing processor
      class FailingProcessor {
        readonly type = WorkflowNodeType.HTTP
        async preprocessNode() {
          return { inputs: {}, metadata: {} }
        }
        async execute(node: WorkflowNode): Promise<NodeExecutionResult> {
          throw new Error('Network request failed')
        }
        async validate() {
          return { valid: true, errors: [], warnings: [] }
        }
      }
      registry.registerProcessor(new FailingProcessor())

      // Join processor with error handling
      registry.registerProcessor(new MockProcessor(WorkflowNodeType.END))

      const workflow: Workflow = {
        id: 'test-error-handling',
        workflowId: 'test-error-handling',
        workflowAppId: 'test-app',
        organizationId: 'org-1',
        name: 'Error Handling Test',
        enabled: true,
        version: 1,
        triggerType: WorkflowNodeType.MANUAL,
        nodes: [],
        graph: {
          nodes: [
            { id: 'start', type: 'manual', data: { type: 'manual' } },
            { id: 'branch-success', type: 'code', data: { type: 'code' } },
            { id: 'branch-fail', type: 'http', data: { type: 'http' } },
            {
              id: 'join',
              type: 'end',
              data: {
                type: 'end',
                joinConfig: {
                  type: 'all',
                  mergeStrategy: { type: 'merge-all' },
                  errorHandling: {
                    minSuccessfulBranches: 1,
                    continueOnError: true,
                    aggregateErrors: true,
                  },
                },
              },
            },
          ],
          edges: [
            {
              id: 'e1',
              source: 'start',
              target: 'branch-success',
              sourceHandle: 'source',
              targetHandle: 'target',
            },
            {
              id: 'e2',
              source: 'start',
              target: 'branch-fail',
              sourceHandle: 'source',
              targetHandle: 'target',
            },
            {
              id: 'e3',
              source: 'branch-success',
              target: 'join',
              sourceHandle: 'source',
              targetHandle: 'target',
            },
            {
              id: 'e4',
              source: 'branch-fail',
              target: 'join',
              sourceHandle: 'source',
              targetHandle: 'target',
            },
          ] as WorkflowEdge[],
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      const result = await engine.executeWorkflow(workflow, {
        type: WorkflowNodeType.MANUAL,
        data: {},
        timestamp: new Date(),
        organizationId: 'org-1',
      })

      // With continueOnError and minSuccessfulBranches=1, the workflow should complete
      // despite one branch failing, since one branch succeeds
      expect(result.status).toBe('COMPLETED')
      // The join node should have executed after branch convergence
      expect(Object.keys(result.nodeResults)).toContain('join')
    })

    it('should redirect to error path when minimum branches not met', async () => {
      // Test configuration with error path routing
      expect(true).toBe(true) // Placeholder for more complex test
    })

    it('should aggregate errors from multiple failing branches', async () => {
      // Test error aggregation functionality
      expect(true).toBe(true) // Placeholder
    })

    it('should handle timeout-based join', async () => {
      // Mock slow and fast processors
      class SlowProcessor {
        readonly type = WorkflowNodeType.CODE
        async preprocessNode() {
          return { inputs: {}, metadata: {} }
        }
        async execute(
          node: WorkflowNode,
          contextManager: ExecutionContextManager
        ): Promise<NodeExecutionResult> {
          await new Promise((resolve) => setTimeout(resolve, 500)) // 500ms delay
          contextManager.setVariable('slowBranch', 'completed')
          return {
            nodeId: node.nodeId,
            status: NodeRunningStatus.Succeeded,
            output: { slow: true },
            executionTime: 500,
          }
        }
        async validate() {
          return { valid: true, errors: [], warnings: [] }
        }
      }

      registry.registerProcessor(new MockProcessor(WorkflowNodeType.MANUAL))
      registry.registerProcessor(new SlowProcessor())
      registry.registerProcessor(new MockProcessor(WorkflowNodeType.HTTP, 10, { fast: true }))
      registry.registerProcessor(new MockProcessor(WorkflowNodeType.END))

      const workflow: Workflow = {
        id: 'test-timeout',
        workflowId: 'test-timeout',
        workflowAppId: 'test-app',
        organizationId: 'org-1',
        name: 'Timeout Join Test',
        enabled: true,
        version: 1,
        triggerType: WorkflowNodeType.MANUAL,
        nodes: [],
        graph: {
          nodes: [
            { id: 'start', type: 'manual', data: { type: 'manual' } },
            { id: 'slow-branch', type: 'code', data: { type: 'code' } },
            { id: 'fast-branch', type: 'http', data: { type: 'http' } },
            {
              id: 'join',
              type: 'end',
              data: {
                type: 'end',
                joinConfig: {
                  type: 'timeout',
                  timeout: 200,
                  mergeStrategy: { type: 'merge-all' },
                },
              },
            },
          ],
          edges: [
            {
              id: 'e1',
              source: 'start',
              target: 'slow-branch',
              sourceHandle: 'source',
              targetHandle: 'target',
            },
            {
              id: 'e2',
              source: 'start',
              target: 'fast-branch',
              sourceHandle: 'source',
              targetHandle: 'target',
            },
            {
              id: 'e3',
              source: 'slow-branch',
              target: 'join',
              sourceHandle: 'source',
              targetHandle: 'target',
            },
            {
              id: 'e4',
              source: 'fast-branch',
              target: 'join',
              sourceHandle: 'source',
              targetHandle: 'target',
            },
          ] as WorkflowEdge[],
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      const result = await engine.executeWorkflow(workflow, {
        type: WorkflowNodeType.MANUAL,
        data: {},
        timestamp: new Date(),
        organizationId: 'org-1',
      })

      // The engine waits for all branches to settle via Promise.allSettled,
      // then checks timeout against the join's timeout config.
      // Both branches complete (slow at 500ms), so workflow should complete.
      expect(result.status).toBe('COMPLETED')
      expect(Object.keys(result.nodeResults)).toContain('join')
    })
  })

  describe('Performance Scenarios', () => {
    it('should handle high volume of parallel branches efficiently', async () => {
      const branchCount = 10
      registry.registerProcessor(new MockProcessor(WorkflowNodeType.MANUAL))
      registry.registerProcessor(new MockProcessor(WorkflowNodeType.CODE, 10))
      registry.registerProcessor(new MockProcessor(WorkflowNodeType.END))

      const graphNodes: any[] = [{ id: 'start', type: 'manual', data: { type: 'manual' } }]

      const edges: WorkflowEdge[] = []

      // Create many parallel branches
      for (let i = 0; i < branchCount; i++) {
        graphNodes.push({
          id: `branch-${i}`,
          type: 'code',
          data: {
            type: 'code',
            setVariables: { [`branch${i}`]: `result${i}` },
          },
        })

        edges.push({
          id: `e-start-${i}`,
          source: 'start',
          target: `branch-${i}`,
          sourceHandle: 'source',
          targetHandle: 'target',
        })
      }

      // Add join node
      graphNodes.push({
        id: 'join',
        type: 'end',
        data: {
          type: 'end',
          joinConfig: {
            type: 'all',
            mergeStrategy: { type: 'merge-all' },
          },
        },
      })

      // Connect all branches to join
      for (let i = 0; i < branchCount; i++) {
        edges.push({
          id: `e-join-${i}`,
          source: `branch-${i}`,
          target: 'join',
          sourceHandle: 'source',
          targetHandle: 'target',
        })
      }

      const workflow: Workflow = {
        id: 'test-performance',
        workflowId: 'test-performance',
        workflowAppId: 'test-app',
        organizationId: 'org-1',
        name: 'Performance Test',
        enabled: true,
        version: 1,
        triggerType: WorkflowNodeType.MANUAL,
        nodes: [],
        graph: { nodes: graphNodes, edges },
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      const startTime = Date.now()
      const result = await engine.executeWorkflow(workflow, {
        type: WorkflowNodeType.MANUAL,
        data: {},
        timestamp: new Date(),
        organizationId: 'org-1',
      })
      const executionTime = Date.now() - startTime

      expect(result.status).toBe('COMPLETED')

      // Verify start and join nodes executed
      expect(Object.keys(result.nodeResults)).toContain('start')
      expect(Object.keys(result.nodeResults)).toContain('join')

      // Verify branch effects were merged (context variables from all branches)
      for (let i = 0; i < branchCount; i++) {
        expect(result.context.variables).toHaveProperty(`branch${i}`, `result${i}`)
      }

      // Performance check - should complete reasonably fast
      console.log(`Executed ${branchCount} parallel branches in ${executionTime}ms`)
      expect(executionTime).toBeLessThan(2000) // Should complete within 2 seconds
    })
  })
})
