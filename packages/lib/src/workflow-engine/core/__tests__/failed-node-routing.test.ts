// packages/lib/src/workflow-engine/core/__tests__/failed-node-routing.test.ts

import { beforeEach, describe, expect, it } from 'vitest'
import { BaseNodeProcessor } from '../../nodes/base-node'
import type { ExecutionContextManager } from '../execution-context'
import type { NodeProcessorRegistry } from '../node-processor-registry'
import type { NodeExecutionResult, Workflow, WorkflowNode, WorkflowTriggerType } from '../types'
import { NodeRunningStatus, WorkflowNodeType } from '../types'
import { WorkflowEngine } from '../workflow-engine'

/** Records which nodes ran so tests can assert the path taken. */
const executedNodes: string[] = []

class MockTriggerProcessor extends BaseNodeProcessor {
  readonly type = WorkflowNodeType.MANUAL

  protected async executeNode(): Promise<Partial<NodeExecutionResult>> {
    return {
      status: NodeRunningStatus.Succeeded,
      output: { triggered: true },
      outputHandle: 'source',
    }
  }
}

/**
 * Fails with whatever outputHandle the node's data dictates — mirrors real
 * processors like crud (`'fail'`) and http (`'fail'` for error_strategy 'fail').
 * When `data.succeedWithHandle` is set it succeeds with that handle instead,
 * mirroring http's error_strategy 'none' continue-on-error result.
 */
class MockFailingProcessor extends BaseNodeProcessor {
  readonly type = 'mock-failing' as WorkflowNodeType

  protected async executeNode(
    node: WorkflowNode,
    _contextManager: ExecutionContextManager
  ): Promise<Partial<NodeExecutionResult>> {
    executedNodes.push(node.nodeId)
    if (node.data.succeedWithHandle) {
      return {
        status: NodeRunningStatus.Succeeded,
        output: { error: 'request failed', status: 0 },
        outputHandle: node.data.succeedWithHandle,
      }
    }
    return {
      status: NodeRunningStatus.Failed,
      error: 'boom',
      output: { error: 'boom' },
      outputHandle: node.data.failHandle,
    }
  }
}

class MockRecorderProcessor extends BaseNodeProcessor {
  readonly type = 'mock-recorder' as WorkflowNodeType

  protected async executeNode(node: WorkflowNode): Promise<Partial<NodeExecutionResult>> {
    executedNodes.push(node.nodeId)
    return {
      status: NodeRunningStatus.Succeeded,
      output: { recorded: true },
      outputHandle: 'source',
    }
  }
}

const edge = (id: string, source: string, target: string, sourceHandle = 'source') => ({
  id,
  source,
  target,
  sourceHandle,
  targetHandle: 'target',
})

const buildWorkflow = (
  failNodeData: Record<string, unknown>,
  failEdgeHandle?: string
): Workflow => ({
  id: 'fail-routing-test',
  workflowId: 'fail-routing-test',
  workflowAppId: 'test-app',
  organizationId: 'test-org',
  name: 'Fail Branch Routing Test',
  enabled: true,
  version: 1,
  triggerType: 'manual' as WorkflowTriggerType,
  nodes: [],
  graph: {
    nodes: [
      { id: 'trigger', type: 'manual', data: { type: 'manual' } },
      { id: 'flaky', type: 'mock-failing', data: { type: 'mock-failing', ...failNodeData } },
      { id: 'success-path', type: 'mock-recorder', data: { type: 'mock-recorder' } },
      { id: 'fail-handler', type: 'mock-recorder', data: { type: 'mock-recorder' } },
    ],
    edges: [
      edge('e1', 'trigger', 'flaky'),
      edge('e2', 'flaky', 'success-path'),
      ...(failEdgeHandle ? [edge('e3', 'flaky', 'fail-handler', failEdgeHandle)] : []),
    ],
  },
  createdAt: new Date(),
  updatedAt: new Date(),
})

const runWorkflow = (engine: WorkflowEngine, workflow: Workflow) =>
  engine.executeWorkflow(workflow, {
    type: 'manual' as WorkflowTriggerType,
    data: {},
    timestamp: new Date(),
    organizationId: 'test-org',
  })

describe('Failed node routing', () => {
  let engine: WorkflowEngine
  let registry: NodeProcessorRegistry

  beforeEach(() => {
    executedNodes.length = 0
    engine = new WorkflowEngine()
    registry = engine.getNodeRegistry()
    registry.registerProcessor(new MockTriggerProcessor())
    registry.registerProcessor(new MockFailingProcessor())
    registry.registerProcessor(new MockRecorderProcessor())
  })

  it('routes a failed node to its wired fail branch via the emitted outputHandle', async () => {
    // The builder renders a 'fail' source handle (http/crud) and persists edges
    // with sourceHandle 'fail'; the processor emits outputHandle 'fail' on failure.
    const workflow = buildWorkflow({ failHandle: 'fail' }, 'fail')

    const result = await runWorkflow(engine, workflow)

    expect(result.status).toBe('COMPLETED')
    expect(executedNodes).toContain('fail-handler')
    expect(executedNodes).not.toContain('success-path')
  })

  it('still honors legacy onError edges as a fallback', async () => {
    const workflow = buildWorkflow({ failHandle: 'fail' }, 'onError')

    const result = await runWorkflow(engine, workflow)

    expect(result.status).toBe('COMPLETED')
    expect(executedNodes).toContain('fail-handler')
    expect(executedNodes).not.toContain('success-path')
  })

  it('fails the workflow when a failed node has no wired fail branch', async () => {
    const workflow = buildWorkflow({ failHandle: 'fail' })

    const result = await runWorkflow(engine, workflow)

    expect(result.status).toBe('FAILED')
    expect(executedNodes).not.toContain('success-path')
    expect(executedNodes).not.toContain('fail-handler')
  })

  it('never routes a failed node down the success path, even without an explicit handle', async () => {
    // A Failed result with no outputHandle must not match the 'source' edge.
    const workflow = buildWorkflow({ failHandle: undefined })

    const result = await runWorkflow(engine, workflow)

    expect(result.status).toBe('FAILED')
    expect(executedNodes).not.toContain('success-path')
  })

  it('continues down the success path when a node swallows its error (http error_strategy none)', async () => {
    // http with error_strategy 'none' returns Succeeded after an error and the
    // builder renders only a 'source' handle for it — continuing down the
    // success path with the error payload as output is the intended behavior.
    const workflow = buildWorkflow({ succeedWithHandle: 'source' })

    const result = await runWorkflow(engine, workflow)

    expect(result.status).toBe('COMPLETED')
    expect(executedNodes).toContain('success-path')
    expect(executedNodes).not.toContain('fail-handler')
  })

  it('falls back to the source route for a succeeded result with an unmatched handle', async () => {
    // Documents the deliberate getNextNodes fallback: a Succeeded result whose
    // handle matches no persisted edge continues via 'source' (logged loudly).
    const workflow = buildWorkflow({ succeedWithHandle: 'error' })

    const result = await runWorkflow(engine, workflow)

    expect(result.status).toBe('COMPLETED')
    expect(executedNodes).toContain('success-path')
    expect(executedNodes).not.toContain('fail-handler')
  })
})
