// packages/lib/src/workflow-engine/core/__tests__/loop-containment.test.ts

/**
 * Loop containment in the engine's type (plan `22-draft-save-discipline.md` §8.3,
 * `23-graph-document-canonicalization.md` §2.3).
 *
 * `getLoopContext`, `buildGraphNode`'s `children` and `buildLoopInfo`'s
 * `childNodeIds` all used to read `node.data.parentId` — a key NOTHING writes.
 * Both authoring paths (`node-factory.ts`, `graph-edit/ops.ts`) write a
 * TOP-LEVEL `parentId`, so `GraphNode.isInLoop` was an exported, documented
 * field that always said `false`.
 *
 * The reads now point at the top-level key, which `transformNodes` copies onto
 * `WorkflowNode`. Deliberately NOT into `node.data` — see the leak test below.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { BaseNodeProcessor } from '../../nodes/base-node'
import { LoopProcessor } from '../../nodes/flow-nodes/loop'
import type { ExecutionContextManager } from '../execution-context'
import { NodeProcessorRegistry } from '../node-processor-registry'
import type { NodeExecutionResult, Workflow, WorkflowNode, WorkflowTriggerType } from '../types'
import { type NodeRunningStatus, NodeRunningStatus as Status, WorkflowNodeType } from '../types'
import { WorkflowEngine } from '../workflow-engine'
import { WorkflowGraphBuilder } from '../workflow-graph-builder'

/**
 * A stored canvas node exactly as `NodeFactory.createNode` persists it: React
 * Flow's `type: 'standard'`, the real node type inside `data.type`, containment
 * as a TOP-LEVEL `parentId` + `extent: 'parent'`, and the canvas' own
 * `data.isInLoop`/`data.loopId` mirrors alongside.
 */
function storedNode(
  id: string,
  nodeType: string,
  opts: { parentId?: string; loopId?: string; data?: Record<string, unknown> } = {}
) {
  const node: Record<string, unknown> = {
    id,
    type: nodeType === 'note' ? 'note' : 'standard',
    position: { x: 0, y: 0 },
    data: {
      id,
      type: nodeType,
      title: id,
      isInLoop: !!opts.parentId,
      loopId: opts.loopId,
      disabled: false,
      ...opts.data,
    },
  }
  if (opts.parentId) {
    node.parentId = opts.parentId
    node.extent = 'parent'
  }
  return node
}

/** loop container `loop-1` with two body nodes and a nested loop `loop-2`. */
function storedLoopWorkflow() {
  return {
    id: 'wf-loop',
    organizationId: 'org-1',
    graph: {
      nodes: [
        storedNode('trigger', 'manual'),
        storedNode('loop-1', 'loop', { data: { itemsSource: '{{items}}' } }),
        storedNode('body-1', 'variable-set', { parentId: 'loop-1', loopId: 'loop-1' }),
        storedNode('loop-2', 'loop', {
          parentId: 'loop-1',
          loopId: 'loop-1',
          data: { itemsSource: '{{inner}}' },
        }),
        // Grandchild: inside `loop-2`, which is itself inside `loop-1`.
        storedNode('body-2', 'variable-set', { parentId: 'loop-2', loopId: 'loop-2' }),
        storedNode('after', 'variable-set'),
      ],
      edges: [
        { id: 'e1', source: 'trigger', target: 'loop-1', sourceHandle: 'source' },
        {
          id: 'e2',
          source: 'loop-1',
          target: 'body-1',
          sourceHandle: 'loop-start',
          targetHandle: 'target',
        },
        {
          id: 'e3',
          source: 'body-1',
          target: 'loop-2',
          sourceHandle: 'source',
          targetHandle: 'target',
        },
        {
          id: 'e4',
          source: 'loop-2',
          target: 'body-2',
          sourceHandle: 'loop-start',
          targetHandle: 'target',
        },
        {
          id: 'e5',
          source: 'body-2',
          target: 'loop-2',
          sourceHandle: 'source',
          targetHandle: 'loop-back',
        },
        {
          id: 'e6',
          source: 'loop-2',
          target: 'loop-1',
          sourceHandle: 'source',
          targetHandle: 'loop-back',
        },
        { id: 'e7', source: 'loop-1', target: 'after', sourceHandle: 'source' },
      ],
    },
  }
}

function registerBuilderRegistry() {
  const registry = new NodeProcessorRegistry()
  for (const type of [
    WorkflowNodeType.MANUAL,
    WorkflowNodeType.LOOP,
    WorkflowNodeType.VARIABLE_SET,
  ]) {
    registry.registerProcessor({
      type,
      preprocessNode: async () => ({ inputs: {}, metadata: {} }),
      execute: async (node) => ({
        nodeId: node.nodeId,
        status: Status.Succeeded,
        output: {},
        executionTime: 0,
      }),
      validate: async () => ({ valid: true, errors: [], warnings: [] }),
    })
  }
  WorkflowGraphBuilder.initialize(registry)
}

describe('loop containment reaches the engine from the stored top-level parentId', () => {
  beforeEach(registerBuilderRegistry)

  it('populates isInLoop and loopId for a direct loop child', () => {
    const graph = WorkflowGraphBuilder.buildGraph(storedLoopWorkflow())

    const body1 = graph.nodes.get('body-1')!
    expect(body1.parentId).toBe('loop-1')
    expect(body1.isInLoop).toBe(true)
    expect(body1.loopId).toBe('loop-1')
  })

  it('walks the ancestor chain for a grandchild of a loop', () => {
    const graph = WorkflowGraphBuilder.buildGraph(storedLoopWorkflow())

    const body2 = graph.nodes.get('body-2')!
    expect(body2.parentId).toBe('loop-2')
    expect(body2.isInLoop).toBe(true)
    // Nearest containing loop wins.
    expect(body2.loopId).toBe('loop-2')
  })

  it('leaves nodes outside every container uncontained', () => {
    const graph = WorkflowGraphBuilder.buildGraph(storedLoopWorkflow())

    for (const id of ['trigger', 'loop-1', 'after']) {
      const node = graph.nodes.get(id)!
      expect(node.parentId).toBeUndefined()
      expect(node.isInLoop).toBe(false)
      expect(node.loopId).toBeUndefined()
    }
  })

  it('populates GraphNode.children for container nodes', () => {
    const graph = WorkflowGraphBuilder.buildGraph(storedLoopWorkflow())

    expect(graph.nodes.get('loop-1')!.children.sort()).toEqual(['body-1', 'loop-2'])
    expect(graph.nodes.get('loop-2')!.children).toEqual(['body-2'])
    expect(graph.nodes.get('after')!.children).toEqual([])
  })

  it('populates LoopNodeInfo.childNodeIds for every loop', () => {
    const graph = WorkflowGraphBuilder.buildGraph(storedLoopWorkflow())

    expect(graph.loopNodes.get('loop-1')!.childNodeIds.sort()).toEqual(['body-1', 'loop-2'])
    expect(graph.loopNodes.get('loop-2')!.childNodeIds).toEqual(['body-2'])
    expect(graph.loopNodes.get('loop-1')!.hasLoopBack).toBe(true)
  })

  /**
   * The load-bearing assertion. Routing containment through `node.data.parentId`
   * would have been the smaller diff, and it costs three regressions — the first
   * being that `PLATFORM_NODE_DATA_KEYS` does not list `parentId`, so every app
   * block inside a loop would forward `parentId` to the app runtime as an input
   * field. `parentId` must live on the node, never in its data bag.
   */
  it('never puts parentId into a node data bag', () => {
    const { graph, workflow } = WorkflowGraphBuilder.build(storedLoopWorkflow())

    for (const node of workflow.nodes) {
      expect(Object.keys(node.data)).not.toContain('parentId')
    }
    for (const node of graph.nodes.values()) {
      expect(Object.keys(node.data)).not.toContain('parentId')
    }
    // …and it IS on the node itself, so nothing was merely dropped.
    expect(workflow.nodes.find((n) => n.nodeId === 'body-1')?.parentId).toBe('loop-1')
  })

  it('ignores a data.parentId that no authoring path writes', () => {
    // Belt and braces: if some legacy document carries the key inside `data`,
    // it must not resurrect the old containment source.
    const wf = storedLoopWorkflow()
    const after = wf.graph.nodes.find((n) => n.id === 'after')!
    ;(after.data as Record<string, unknown>).parentId = 'loop-1'

    const graph = WorkflowGraphBuilder.buildGraph(wf)
    expect(graph.nodes.get('after')!.isInLoop).toBe(false)
    expect(graph.nodes.get('loop-1')!.children.sort()).toEqual(['body-1', 'loop-2'])
  })
})

/**
 * End-to-end proof that the change is INERT. Loop execution is entirely edge-
 * and handle-driven (`LoopExecutionManager` finds the body through `loop-start`
 * and ends an iteration on a `loop-back` targetHandle), so populating the four
 * containment fields must not alter a single step. Green is the point.
 */
class RecordingProcessor extends BaseNodeProcessor {
  readonly type = WorkflowNodeType.VARIABLE_SET
  static seen: string[] = []

  protected async executeNode(
    node: WorkflowNode,
    contextManager: ExecutionContextManager
  ): Promise<Partial<NodeExecutionResult>> {
    const item = await contextManager.getVariable('item')
    RecordingProcessor.seen.push(`${node.nodeId}:${JSON.stringify(item ?? null)}`)
    return {
      status: 'succeeded' as NodeRunningStatus,
      output: { item },
      outputHandle: 'source',
    }
  }
}

class ManualTriggerProcessor extends BaseNodeProcessor {
  readonly type = WorkflowNodeType.MANUAL

  protected async executeNode(): Promise<Partial<NodeExecutionResult>> {
    return {
      status: 'succeeded' as NodeRunningStatus,
      output: { triggered: true },
      outputHandle: 'source',
    }
  }
}

/** Single loop over three items; the body records each iteration's `item`. */
function runnableLoopWorkflow(): Workflow {
  return {
    id: 'wf-loop-e2e',
    workflowId: 'wf-loop-e2e',
    workflowAppId: 'test-app',
    organizationId: 'org-1',
    name: 'Loop e2e',
    enabled: true,
    version: 1,
    triggerType: 'manual' as WorkflowTriggerType,
    nodes: [],
    graph: {
      nodes: [
        storedNode('trigger', 'manual'),
        storedNode('loop-1', 'loop', {
          data: { itemsSource: '{{items}}', maxIterations: 10, accumulateResults: true },
        }),
        storedNode('body', 'variable-set', { parentId: 'loop-1', loopId: 'loop-1' }),
        storedNode('after', 'variable-set'),
      ],
      edges: [
        { id: 'e1', source: 'trigger', target: 'loop-1', sourceHandle: 'source' },
        {
          id: 'e2',
          source: 'loop-1',
          target: 'body',
          sourceHandle: 'loop-start',
          targetHandle: 'target',
        },
        {
          id: 'e3',
          source: 'body',
          target: 'loop-1',
          sourceHandle: 'source',
          targetHandle: 'loop-back',
        },
        { id: 'e4', source: 'loop-1', target: 'after', sourceHandle: 'source' },
      ],
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as Workflow
}

describe('loop execution end to end is unchanged by the containment fix', () => {
  let engine: WorkflowEngine

  beforeEach(() => {
    RecordingProcessor.seen = []
    engine = new WorkflowEngine()
    const registry = engine.getNodeRegistry()
    registry.registerProcessor(new ManualTriggerProcessor())
    registry.registerProcessor(new RecordingProcessor())
    // The real loop processor — the point is that loop execution is unchanged.
    registry.registerProcessor(new LoopProcessor())
  })

  it('iterates the body once per item and continues past the loop', async () => {
    const result = await engine.executeWorkflow(
      runnableLoopWorkflow(),
      {
        type: 'manual' as WorkflowTriggerType,
        data: {},
        timestamp: new Date(),
        organizationId: 'org-1',
      },
      { variables: { items: ['a', 'b', 'c'] } }
    )

    expect(result.status).toBe('COMPLETED')
    // The body runs once per item, then execution leaves via the loop's `source`
    // handle. `after` still observes `item` as the last iteration's value —
    // pre-existing behaviour (the loop's item variable is not unset on exit),
    // pinned here so a regression in it is not mistaken for this change.
    expect(RecordingProcessor.seen).toEqual(['body:"a"', 'body:"b"', 'body:"c"', 'after:"c"'])
    expect(result.nodeResults).toHaveProperty('loop-1')
    expect(result.nodeResults).toHaveProperty('after')
  })
})
