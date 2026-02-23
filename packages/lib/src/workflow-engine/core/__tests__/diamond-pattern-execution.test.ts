// packages/lib/src/workflow-engine/core/__tests__/diamond-pattern-execution.test.ts

import { beforeEach, describe, expect, it } from 'vitest'
import { BaseNodeProcessor } from '../../nodes/base-node'
import type { ExecutionContextManager } from '../execution-context'
import type { NodeProcessorRegistry } from '../node-processor-registry'
import type { NodeExecutionResult, Workflow, WorkflowNode, WorkflowTriggerType } from '../types'
import { type NodeRunningStatus, WorkflowNodeType } from '../types'
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
    // The engine handles branch merging in handleJoinPoint() before executing this node.
    // Branch variables are already merged into the context by the time we get here.
    // Read the branch summary set by the engine's handleJoinPoint method.
    const branchSummary = await contextManager.getVariable('_branchSummary')

    contextManager.setVariable('join_result', {
      branchCount: branchSummary?.total ?? 0,
      branches: branchSummary ? Object.keys(branchSummary) : [],
      merged: true,
    })

    return {
      status: 'succeeded' as NodeRunningStatus,
      output: { joined: true, branchSummary },
      outputHandle: 'source',
    }
  }
}

describe('Diamond Pattern Execution', () => {
  let engine: WorkflowEngine
  let registry: NodeProcessorRegistry

  beforeEach(() => {
    engine = new WorkflowEngine()
    registry = engine.getNodeRegistry()
    registry.registerProcessor(new MockTriggerProcessor())
    registry.registerProcessor(new MockActionProcessor())
    registry.registerProcessor(new MockJoinProcessor())
  })

  it('should execute basic diamond pattern successfully', async () => {
    const workflow: Workflow = {
      id: 'diamond-test',
      workflowId: 'diamond-test',
      workflowAppId: 'test-app',
      organizationId: 'test-org',
      name: 'Diamond Pattern Test',
      enabled: true,
      version: 1,
      triggerType: 'manual' as WorkflowTriggerType,
      nodes: [],
      graph: {
        nodes: [
          { id: 'trigger', type: 'manual', data: { type: 'manual' } },
          {
            id: 'branch-a',
            type: 'mock-action',
            data: { type: 'mock-action', branchId: 'a', delay: 50 },
          },
          {
            id: 'branch-b',
            type: 'mock-action',
            data: { type: 'mock-action', branchId: 'b', delay: 100 },
          },
          { id: 'join', type: 'mock-join', data: { type: 'mock-join', joinType: 'all' } },
        ],
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
    expect(result.nodeResults).toHaveProperty('join')

    // Check that both branches executed (variables merged by engine at join point)
    expect(result.context.variables).toHaveProperty('branch_a_result', 'completed_a')
    expect(result.context.variables).toHaveProperty('branch_b_result', 'completed_b')

    // Check that join node executed and set its result
    expect(result.context.variables).toHaveProperty('join_result')
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
      workflowId: 'diamond-fail-test',
      workflowAppId: 'test-app',
      organizationId: 'test-org',
      name: 'Diamond Pattern Fail Test',
      enabled: true,
      version: 1,
      triggerType: 'manual' as WorkflowTriggerType,
      nodes: [],
      graph: {
        nodes: [
          { id: 'trigger', type: 'manual', data: { type: 'manual' } },
          { id: 'branch-a', type: 'mock-failing', data: { type: 'mock-failing' } },
          { id: 'branch-b', type: 'mock-action', data: { type: 'mock-action', branchId: 'b' } },
          {
            id: 'join',
            type: 'mock-join',
            data: {
              type: 'mock-join',
              joinType: 'all',
              errorHandling: { continueOnError: false },
            },
          },
        ],
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

    // With fail-fast error handling and a failing branch, the workflow should fail
    expect(result.status).toBe('FAILED')
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

        // Each branch sets its own unique variable
        contextManager.setVariable(`unique_${branchId}`, `value_${branchId}`)

        // Set a branch-specific list item (shared_list merging handled by engine)
        contextManager.setVariable(`branch_item_${branchId}`, `item_from_${branchId}`)

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
      workflowId: 'merge-test',
      workflowAppId: 'test-app',
      organizationId: 'test-org',
      name: 'Context Merge Test',
      enabled: true,
      version: 1,
      triggerType: 'manual' as WorkflowTriggerType,
      nodes: [],
      graph: {
        nodes: [
          { id: 'trigger', type: 'manual', data: { type: 'manual' } },
          { id: 'branch-a', type: 'mock-merging', data: { type: 'mock-merging', branchId: 'a' } },
          { id: 'branch-b', type: 'mock-merging', data: { type: 'mock-merging', branchId: 'b' } },
          {
            id: 'join',
            type: 'mock-join',
            data: {
              type: 'mock-join',
              joinType: 'all',
              mergeStrategy: { type: 'merge-all' },
            },
          },
        ],
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

    // Check that unique variables from both branches exist after merge
    expect(result.context.variables).toHaveProperty('unique_a', 'value_a')
    expect(result.context.variables).toHaveProperty('unique_b', 'value_b')

    // Check branch-specific items were preserved through merge
    expect(result.context.variables).toHaveProperty('branch_item_a', 'item_from_a')
    expect(result.context.variables).toHaveProperty('branch_item_b', 'item_from_b')
  })
})
