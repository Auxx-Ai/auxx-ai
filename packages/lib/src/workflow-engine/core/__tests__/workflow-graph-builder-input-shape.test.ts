// packages/lib/src/workflow-engine/core/__tests__/workflow-graph-builder-input-shape.test.ts

import { beforeEach, describe, expect, it } from 'vitest'
import { NodeProcessorRegistry } from '../node-processor-registry'
import { NodeRunningStatus, WorkflowNodeType } from '../types'
import { WorkflowGraphBuilder } from '../workflow-graph-builder'

/**
 * WHERE `buildGraph` looks for the graph — the one part of its contract the
 * compiler cannot hold.
 *
 * It takes `any` ("accept raw database format") and reads
 * `workflow.graph || { nodes: [], edges: [] }`, and nothing else. Hand it a
 * workflow-shaped object with the nodes at the TOP level and it builds an empty
 * graph in silence: `findEntryNode` returns undefined, the engine throws "No
 * entry point found in workflow", the run comes back FAILED — and a caller that
 * does not inspect `result.status` reports success.
 *
 * That is not hypothetical. The production webhook route
 * (`apps/web/src/app/api/workflows/[workflowId]/webhook/route.ts`) passed
 * exactly that shape, so every published `webhook`-triggered workflow was a
 * silent no-op that still answered the caller 200. Four other `executeWorkflow`
 * callers pass a database row and were unaffected.
 *
 * Kept in its own file, separate from the behavioural
 * `workflow-graph-builder.test.ts`, because this pins an INPUT contract rather
 * than graph-building behaviour — and because the route-side half of the same
 * contract lives in another package
 * (`webhook-draft-test-window.test.ts` → "hands the engine a payload the graph
 * builder can actually read"). Neither test alone would have caught the bug.
 */
describe('WorkflowGraphBuilder input shape', () => {
  const nodes = [
    { id: 'node1', type: 'manual', data: { type: 'manual' } },
    { id: 'node2', type: 'end', data: { type: 'end' } },
  ]
  const edges = [{ id: 'edge1', source: 'node1', target: 'node2' }]

  beforeEach(() => {
    const nodeRegistry = new NodeProcessorRegistry()
    for (const type of [WorkflowNodeType.MANUAL, WorkflowNodeType.END]) {
      nodeRegistry.registerProcessor({
        type,
        preprocessNode: async () => ({ inputs: {}, metadata: {} }),
        execute: async (node) => ({
          nodeId: node.nodeId,
          status: NodeRunningStatus.Succeeded,
          output: {},
          executionTime: 0,
        }),
        validate: async () => ({ valid: true, errors: [], warnings: [] }),
      })
    }
    WorkflowGraphBuilder.initialize(nodeRegistry)
  })

  it('builds from `workflow.graph`', () => {
    const graph = WorkflowGraphBuilder.buildGraph({ id: 'wf', graph: { nodes, edges } })

    expect(graph.nodes.size).toBe(2)
    expect(graph.nodes.has('node1')).toBe(true)
  })

  it('builds NOTHING from top-level `nodes` / `edges`', () => {
    const graph = WorkflowGraphBuilder.buildGraph({ id: 'wf', nodes, edges })

    expect(graph.nodes.size).toBe(0)
  })
})
