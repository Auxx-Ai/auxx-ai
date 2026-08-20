// packages/lib/src/workflow-engine/core/__tests__/graph-cache-workflow-pairing.test.ts

/**
 * B-3 (plan `23-graph-document-canonicalization.md` §8 "B-3"):
 * the engine used to read the transformed workflow document from a
 * `private static` slot on `WorkflowGraphBuilder` that was written ONLY on the
 * graph-cache MISS path. One slot per process, read unconditionally — so a
 * cache HIT ran the graph of workflow A against the node list of whichever
 * workflow the process transformed last.
 *
 * The graph and the document it was derived from are now cached as one pair,
 * so a hit can never hand a run a foreign workflow's document.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { BaseNodeProcessor } from '../../nodes/base-node'

import type { NodeExecutionResult, Workflow, WorkflowNode, WorkflowTriggerType } from '../types'
import { type NodeRunningStatus, WorkflowNodeType } from '../types'
import { WorkflowEngine } from '../workflow-engine'

class MockTriggerProcessor extends BaseNodeProcessor {
  readonly type = WorkflowNodeType.MANUAL

  protected async executeNode(node: WorkflowNode): Promise<Partial<NodeExecutionResult>> {
    return {
      status: 'succeeded' as NodeRunningStatus,
      output: { triggered: true, nodeId: node.nodeId },
      outputHandle: 'source',
    }
  }
}

class MockActionProcessor extends BaseNodeProcessor {
  readonly type = 'mock-action' as WorkflowNodeType

  protected async executeNode(node: WorkflowNode): Promise<Partial<NodeExecutionResult>> {
    return {
      status: 'succeeded' as NodeRunningStatus,
      output: { nodeId: node.nodeId },
      outputHandle: 'source',
    }
  }
}

/** Two-node workflow: a manual trigger wired to one action, ids prefixed per workflow. */
function makeWorkflow(prefix: string): Workflow {
  return {
    id: `wf-${prefix}`,
    workflowId: `wf-${prefix}`,
    workflowAppId: 'test-app',
    organizationId: `org-${prefix}`,
    name: `Workflow ${prefix}`,
    enabled: true,
    version: 1,
    triggerType: 'manual' as WorkflowTriggerType,
    nodes: [],
    graph: {
      nodes: [
        { id: `${prefix}-trigger`, type: 'manual', data: { type: 'manual' } },
        { id: `${prefix}-action`, type: 'mock-action', data: { type: 'mock-action' } },
      ],
      edges: [
        {
          id: `${prefix}-edge`,
          source: `${prefix}-trigger`,
          target: `${prefix}-action`,
          sourceHandle: 'source',
          targetHandle: 'target',
        },
      ],
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as Workflow
}

const trigger = (prefix: string) => ({
  type: 'manual' as WorkflowTriggerType,
  data: {},
  timestamp: new Date(),
  organizationId: `org-${prefix}`,
})

describe('graph cache pairs the graph with the document it was built from', () => {
  let engine: WorkflowEngine

  beforeEach(() => {
    engine = new WorkflowEngine()
    const registry = engine.getNodeRegistry()
    registry.registerProcessor(new MockTriggerProcessor())
    registry.registerProcessor(new MockActionProcessor())
  })

  it('runs A on a cache hit even after B was transformed in between', async () => {
    const wfA = makeWorkflow('a')
    const wfB = makeWorkflow('b')

    // 1. cache MISS on A — builds and caches A
    const first = await engine.executeWorkflow(wfA, trigger('a'))
    expect(first.status).toBe('COMPLETED')
    expect(first.nodeResults).toHaveProperty('a-trigger')

    // 2. cache MISS on B — builds and caches B; used to overwrite the shared static
    const second = await engine.executeWorkflow(wfB, trigger('b'))
    expect(second.status).toBe('COMPLETED')
    expect(second.nodeResults).toHaveProperty('b-trigger')

    // 3. cache HIT on A — no build, so the document must come from the cached pair
    const third = await engine.executeWorkflow(wfA, trigger('a'))
    expect(third.status).toBe('COMPLETED')
    expect(third.nodeResults).toHaveProperty('a-trigger')
    expect(third.nodeResults).toHaveProperty('a-action')
    expect(third.nodeResults).not.toHaveProperty('b-trigger')
    expect(third.nodeResults).not.toHaveProperty('b-action')
  })

  it('publishes the running workflow as sys.workflow on a cache hit', async () => {
    const wfA = makeWorkflow('a')
    const wfB = makeWorkflow('b')

    await engine.executeWorkflow(wfA, trigger('a'))
    await engine.executeWorkflow(wfB, trigger('b'))
    const third = await engine.executeWorkflow(wfA, trigger('a'))

    expect((third.context.variables['sys.workflow'] as Workflow | undefined)?.id).toBe('wf-a')
  })

  it('is not poisoned by a foreign buildGraph between two runs of the same workflow', async () => {
    const wfA = makeWorkflow('a')
    const wfB = makeWorkflow('b')

    await engine.executeWorkflow(wfA, trigger('a'))

    // A *separate* engine — e.g. `WorkflowExecutionService`'s per-call instance, or
    // the builder's run-this-node — transforming any other workflow in the same process.
    const otherEngine = new WorkflowEngine()
    const otherRegistry = otherEngine.getNodeRegistry()
    otherRegistry.registerProcessor(new MockTriggerProcessor())
    otherRegistry.registerProcessor(new MockActionProcessor())
    await otherEngine.executeWorkflow(wfB, trigger('b'))

    const third = await engine.executeWorkflow(wfA, trigger('a'))
    expect(third.nodeResults).toHaveProperty('a-trigger')
    expect(third.nodeResults).not.toHaveProperty('b-trigger')
  })
})
