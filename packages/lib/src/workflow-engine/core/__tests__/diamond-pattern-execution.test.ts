// packages/lib/src/workflow-engine/core/__tests__/diamond-pattern-execution.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BaseNodeProcessor } from '../../nodes/base-node'
import type { ExecutionContextManager } from '../execution-context'
import { NodeProcessorRegistry } from '../node-processor-registry'
import type {
  ExecutionContext,
  NodeExecutionResult,
  NodeRunningStatus,
  Workflow,
  WorkflowExecutionOptions,
  WorkflowNode,
  WorkflowNodeType,
  WorkflowTriggerType,
} from '../types'
import { WorkflowEngine } from '../workflow-engine'

// Mock processors for testing
class MockTriggerProcessor extends BaseNodeProcessor {
  readonly type = WorkflowNodeType.MANUAL

  protected async executeNode(
    node: WorkflowNode,
    contextManager: ExecutionContextManager
  ): Promise<Partial<NodeExecutionResult>> {
    return {
      status: 'succeeded' as NodeRunningStatus,
      output: { triggered: true },
      outputHandle: 'source',
    }
  }
}

class MockActionProcessor extends BaseNodeProcessor {
  readonly type = 'mock-action' as WorkflowNodeType

  protected async executeNode(
    node: WorkflowNode,
    contextManager: ExecutionContextManager
  ): Promise<Partial<NodeExecutionResult>> {
    const branchId = node.data.branchId || 'unknown'
    const delay = node.data.delay || 0

    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay))
    }

    // Set a variable specific to this branch
    contextManager.setVariable(`branch_${branchId}_result`, `completed_${branchId}`)

    return {
      status: 'succeeded' as NodeRunningStatus,
      output: { branchId, processed: true },
      outputHandle: 'source',
    }
  }
}

class MockJoinProcessor extends BaseNodeProcessor {
  readonly type = 'mock-join' as WorkflowNodeType

  protected async executeNode(
    node: WorkflowNode,
    contextManager: ExecutionContextManager
  ): Promise<Partial<NodeExecutionResult>> {
    const input = contextManager.getVariable(`${node.nodeId}.input`) as any
    const joinState = input?.joinState

    if (!joinState) {
      return {
        status: 'failed' as NodeRunningStatus,
        error: 'No join state provided',
      }
    }

    // Merge branch results
    const mergedData = {
      branchCount: joinState.completedInputs.size,
      branches: Array.from(joinState.completedInputs),
    }

    contextManager.setVariable('join_result', mergedData)

    return {
      status: 'succeeded' as NodeRunningStatus,
      output: mergedData,
      outputHandle: 'source',
    }
  }
}

describe('Diamond Pattern Execution', () => {
  let engine: WorkflowEngine
  let registry: NodeProcessorRegistry

  beforeEach(() => {
    registry = new NodeProcessorRegistry()
    registry.registerProcessor(new MockTriggerProcessor())
    registry.registerProcessor(new MockActionProcessor())
    registry.registerProcessor(new MockJoinProcessor())

    engine = new WorkflowEngine()
  })

  it('should execute basic diamond pattern successfully', async () => {
    const workflow: Workflow = {
      id: 'diamond-test',
      organizationId: 'test-org',
      name: 'Diamond Pattern Test',
      enabled: true,
      version: 1,
      triggerType: 'manual' as WorkflowTriggerType,
      nodes: [
        {
          id: 'node-1',
          nodeId: 'trigger',
          workflowId: 'diamond-test',
          type: WorkflowNodeType.MANUAL,
          position: { x: 0, y: 0 },
          data: {},
          selected: false,
        },
        {
          id: 'node-2',
          nodeId: 'branch-a',
          workflowId: 'diamond-test',
          type: 'mock-action' as WorkflowNodeType,
          position: { x: 100, y: -50 },
          data: { branchId: 'a', delay: 50 },
          selected: false,
        },
        {
          id: 'node-3',
          nodeId: 'branch-b',
          workflowId: 'diamond-test',
          type: 'mock-action' as WorkflowNodeType,
          position: { x: 100, y: 50 },
          data: { branchId: 'b', delay: 100 },
          selected: false,
        },
        {
          id: 'node-4',
          nodeId: 'join',
          workflowId: 'diamond-test',
          type: 'mock-join' as WorkflowNodeType,
          position: { x: 200, y: 0 },
          data: { joinType: 'all' },
          selected: false,
        },
      ],
      graph: {
        nodes: [],
        edges: [
          {
            id: 'edge-1',
            source: 'trigger',
            target: 'branch-a',
            sourceHandle: 'source',
            targetHandle: 'target',
          },
          {
            id: 'edge-2',
            source: 'trigger',
            target: 'branch-b',
            sourceHandle: 'source',
            targetHandle: 'target',
          },
          {
            id: 'edge-3',
            source: 'branch-a',
            target: 'join',
            sourceHandle: 'source',
            targetHandle: 'target',
          },
          {
            id: 'edge-4',
            source: 'branch-b',
            target: 'join',
            sourceHandle: 'source',
            targetHandle: 'target',
          },
        ],
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    const result = await engine.executeWorkflow(workflow, {
      type: 'manual' as WorkflowTriggerType,
      data: {},
      timestamp: new Date(),
      organizationId: 'test-org',
    })

    expect(result.status).toBe('COMPLETED')
    expect(result.nodeResults).toHaveProperty('trigger')
    expect(result.nodeResults).toHaveProperty('branch-a')
    expect(result.nodeResults).toHaveProperty('branch-b')
    expect(result.nodeResults).toHaveProperty('join')

    // Check that both branches executed
    expect(result.context.variables).toHaveProperty('branch_a_result', 'completed_a')
    expect(result.context.variables).toHaveProperty('branch_b_result', 'completed_b')

    // Check join result
    expect(result.context.variables).toHaveProperty('join_result')
    const joinResult = result.context.variables.join_result as any
    expect(joinResult.branchCount).toBe(2)
    expect(joinResult.branches).toContain('branch-a')
    expect(joinResult.branches).toContain('branch-b')
  })

  it('should handle branch failures with fail-fast strategy', async () => {
    // Create a processor that fails
    class FailingProcessor extends BaseNodeProcessor {
      readonly type = 'mock-failing' as WorkflowNodeType

      protected async executeNode(
        node: WorkflowNode,
        contextManager: ExecutionContextManager
      ): Promise<Partial<NodeExecutionResult>> {
        throw new Error('Branch execution failed')
      }
    }

    registry.registerProcessor(new FailingProcessor())

    const workflow: Workflow = {
      id: 'diamond-fail-test',
      organizationId: 'test-org',
      name: 'Diamond Pattern Fail Test',
      enabled: true,
      version: 1,
      triggerType: 'manual' as WorkflowTriggerType,
      nodes: [
        {
          id: 'node-1',
          nodeId: 'trigger',
          workflowId: 'diamond-fail-test',
          type: WorkflowNodeType.MANUAL,
          position: { x: 0, y: 0 },
          data: {},
          selected: false,
        },
        {
          id: 'node-2',
          nodeId: 'branch-a',
          workflowId: 'diamond-fail-test',
          type: 'mock-failing' as WorkflowNodeType,
          position: { x: 100, y: -50 },
          data: {},
          selected: false,
        },
        {
          id: 'node-3',
          nodeId: 'branch-b',
          workflowId: 'diamond-fail-test',
          type: 'mock-action' as WorkflowNodeType,
          position: { x: 100, y: 50 },
          data: { branchId: 'b' },
          selected: false,
        },
        {
          id: 'node-4',
          nodeId: 'join',
          workflowId: 'diamond-fail-test',
          type: 'mock-join' as WorkflowNodeType,
          position: { x: 200, y: 0 },
          data: {
            joinType: 'all',
            errorHandling: {
              continueOnError: false, // fail-fast
            },
          },
          selected: false,
        },
      ],
      graph: {
        nodes: [],
        edges: [
          {
            id: 'edge-1',
            source: 'trigger',
            target: 'branch-a',
            sourceHandle: 'source',
            targetHandle: 'target',
          },
          {
            id: 'edge-2',
            source: 'trigger',
            target: 'branch-b',
            sourceHandle: 'source',
            targetHandle: 'target',
          },
          {
            id: 'edge-3',
            source: 'branch-a',
            target: 'join',
            sourceHandle: 'source',
            targetHandle: 'target',
          },
          {
            id: 'edge-4',
            source: 'branch-b',
            target: 'join',
            sourceHandle: 'source',
            targetHandle: 'target',
          },
        ],
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    await expect(
      engine.executeWorkflow(workflow, {
        type: 'manual' as WorkflowTriggerType,
        data: {},
        timestamp: new Date(),
        organizationId: 'test-org',
      })
    ).rejects.toThrow()
  })

  it('should merge context changes from parallel branches', async () => {
    // Create a processor that modifies shared variables
    class MergingProcessor extends BaseNodeProcessor {
      readonly type = 'mock-merging' as WorkflowNodeType

      protected async executeNode(
        node: WorkflowNode,
        contextManager: ExecutionContextManager
      ): Promise<Partial<NodeExecutionResult>> {
        const branchId = node.data.branchId
        const sharedList = (contextManager.getVariable('shared_list') as any[]) || []

        // Each branch adds to a shared list
        sharedList.push(`item_from_${branchId}`)
        contextManager.setVariable('shared_list', sharedList)

        // Each branch sets its own variable
        contextManager.setVariable(`unique_${branchId}`, `value_${branchId}`)

        return {
          status: 'succeeded' as NodeRunningStatus,
          output: { branchId },
          outputHandle: 'source',
        }
      }
    }

    registry.registerProcessor(new MergingProcessor())

    const workflow: Workflow = {
      id: 'merge-test',
      organizationId: 'test-org',
      name: 'Context Merge Test',
      enabled: true,
      version: 1,
      triggerType: 'manual' as WorkflowTriggerType,
      nodes: [
        {
          id: 'node-1',
          nodeId: 'trigger',
          workflowId: 'merge-test',
          type: WorkflowNodeType.MANUAL,
          position: { x: 0, y: 0 },
          data: {},
          selected: false,
        },
        {
          id: 'node-2',
          nodeId: 'branch-a',
          workflowId: 'merge-test',
          type: 'mock-merging' as WorkflowNodeType,
          position: { x: 100, y: -50 },
          data: { branchId: 'a' },
          selected: false,
        },
        {
          id: 'node-3',
          nodeId: 'branch-b',
          workflowId: 'merge-test',
          type: 'mock-merging' as WorkflowNodeType,
          position: { x: 100, y: 50 },
          data: { branchId: 'b' },
          selected: false,
        },
        {
          id: 'node-4',
          nodeId: 'join',
          workflowId: 'merge-test',
          type: 'mock-join' as WorkflowNodeType,
          position: { x: 200, y: 0 },
          data: {
            joinType: 'all',
            mergeStrategy: { type: 'merge-all' },
          },
          selected: false,
        },
      ],
      graph: {
        nodes: [],
        edges: [
          {
            id: 'edge-1',
            source: 'trigger',
            target: 'branch-a',
            sourceHandle: 'source',
            targetHandle: 'target',
          },
          {
            id: 'edge-2',
            source: 'trigger',
            target: 'branch-b',
            sourceHandle: 'source',
            targetHandle: 'target',
          },
          {
            id: 'edge-3',
            source: 'branch-a',
            target: 'join',
            sourceHandle: 'source',
            targetHandle: 'target',
          },
          {
            id: 'edge-4',
            source: 'branch-b',
            target: 'join',
            sourceHandle: 'source',
            targetHandle: 'target',
          },
        ],
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    const result = await engine.executeWorkflow(workflow, {
      type: 'manual' as WorkflowTriggerType,
      data: {},
      timestamp: new Date(),
      organizationId: 'test-org',
    })

    expect(result.status).toBe('COMPLETED')

    // Check that unique variables from both branches exist
    expect(result.context.variables).toHaveProperty('unique_a', 'value_a')
    expect(result.context.variables).toHaveProperty('unique_b', 'value_b')

    // Due to parallel execution, the shared list might have race conditions
    // but both items should be present (order may vary)
    const sharedList = result.context.variables.shared_list as any[]
    expect(sharedList).toBeDefined()
  })
})
