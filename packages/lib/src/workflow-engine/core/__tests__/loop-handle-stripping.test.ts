// packages/lib/src/workflow-engine/core/__tests__/loop-handle-stripping.test.ts
//
// THE invariant that makes `stripDefaultHandles` safe: the engine hydrates
// before it routes.
//
// `LoopExecutionManager.resolveNextNodeForLoop` matches
// `edge.sourceHandle === outputHandle` with `outputHandle` defaulting to
// `'source'` — a strict comparison against a literal, with no `?? 'source'` on
// the edge side. So an edge that stores NO `sourceHandle` at all is invisible
// to it, and a loop body ends after its first node.
//
// That is not hypothetical: 720 stored edges omit the handle, and
// sequence-compiled graphs have never written one. It works today only because
// the array that comparison reads — `currentWorkflow.graph.edges` — is
// `hydrateGraph`'s output, filled at `WorkflowGraphBuilder.build()`. Nothing
// asserted that, which is why plan `23` left the strip disabled.
//
// This test is the assertion. It passes with the strip on or off; it fails if
// anyone removes the hydration boundary at `workflow-graph-builder.ts:160-166`,
// or adds a loop path that reads a stored row directly.
//
// Teeth verified by hand while writing: commenting out that `hydrateGraph` call
// makes the three-node walk stop after one node.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ExecutionContextManager } from '../execution-context'
import { LoopExecutionManager, type NodeExecutionCallback } from '../loop-execution-manager'
import type { WorkflowExecutionOptions, WorkflowNode } from '../types'
import { NodeRunningStatus } from '../types'
import { WorkflowGraphBuilder } from '../workflow-graph-builder'

/** A canvas/stored node — `data.type` only, no engine `type` field. */
const storedNode = (id: string, type: string) => ({
  id,
  position: { x: 0, y: 0 },
  data: { type, title: id },
})

/**
 * The stored document, in the shape the column actually holds: the two handles
 * that CARRY meaning (`loop-start`, `loop-back`) are written, and every edge
 * that would default is simply absent — no `sourceHandle`, no `targetHandle`.
 *
 * loop-1 --loop-start--> body-1 -> body-2 -> body-3 --loop-back--> loop-1
 */
const storedWorkflow = {
  id: 'wf-1',
  organizationId: 'org-1',
  name: 'Loop over three body nodes',
  version: 1,
  graph: {
    nodes: [
      storedNode('loop-1', 'loop'),
      storedNode('body-1', 'code'),
      storedNode('body-2', 'code'),
      storedNode('body-3', 'code'),
    ],
    edges: [
      { id: 'e1', source: 'loop-1', target: 'body-1', sourceHandle: 'loop-start' },
      { id: 'e2', source: 'body-1', target: 'body-2' },
      { id: 'e3', source: 'body-2', target: 'body-3' },
      { id: 'e4', source: 'body-3', target: 'loop-1', targetHandle: 'loop-back' },
    ],
  },
}

describe('default handles survive the engine because build() hydrates', () => {
  let manager: LoopExecutionManager
  let executeNodeCallback: ReturnType<typeof vi.fn>
  let contextManager: ExecutionContextManager

  beforeEach(() => {
    executeNodeCallback = vi.fn(async (node: WorkflowNode) => ({
      nodeId: node.nodeId,
      status: NodeRunningStatus.Succeeded,
      output: { nodeId: node.nodeId },
      executionTime: 1,
    }))
    manager = new LoopExecutionManager(executeNodeCallback as unknown as NodeExecutionCallback)
    contextManager = new ExecutionContextManager('wf-1', 'exec-1', 'org-1', 'user-1')
  })

  it('fills every absent handle, so the routing comparison has something to match', () => {
    const { workflow } = WorkflowGraphBuilder.build(storedWorkflow)

    for (const edge of workflow.graph?.edges ?? []) {
      expect(edge.sourceHandle, `edge ${edge.id} sourceHandle`).toBeDefined()
      expect(edge.targetHandle, `edge ${edge.id} targetHandle`).toBeDefined()
    }
    // ...and the authored ones are not overwritten by the fill.
    const byId = new Map((workflow.graph?.edges ?? []).map((e) => [e.id, e]))
    expect(byId.get('e1')?.sourceHandle).toBe('loop-start')
    expect(byId.get('e4')?.targetHandle).toBe('loop-back')
  })

  it('walks a three-node body whose edges stored no handles at all', async () => {
    const { workflow } = WorkflowGraphBuilder.build(storedWorkflow)
    const loopNode = workflow.nodes?.find((n) => n.nodeId === 'loop-1')
    expect(loopNode).toBeDefined()

    // The loop processor is what invokes the injected body callback; drive it
    // directly so this test is about routing, not about loop-item resolution.
    const processor: {
      preprocessNode: ReturnType<typeof vi.fn>
      execute: ReturnType<typeof vi.fn>
      executeLoopBodyCallback?: (
        node: WorkflowNode,
        ctx: ExecutionContextManager
      ) => Promise<unknown>
    } = {
      preprocessNode: vi.fn().mockResolvedValue({}),
      execute: vi.fn().mockImplementation(async () => {
        if (!processor.executeLoopBodyCallback) {
          throw new Error('executeLoopBodyCallback was not injected onto the processor')
        }
        return processor.executeLoopBodyCallback(loopNode as WorkflowNode, contextManager)
      }),
    }

    await manager.setupLoopExecution(
      loopNode as WorkflowNode,
      processor as never,
      contextManager,
      {} as WorkflowExecutionOptions,
      workflow
    )

    // The failure mode this guards: body-1 executes, `resolveNextNodeForLoop`
    // finds no edge whose `sourceHandle` equals `'source'`, and the body ends
    // one node in. All three must run.
    const executed = executeNodeCallback.mock.calls.map((c) => (c[0] as WorkflowNode).nodeId)
    expect(executed).toEqual(['body-1', 'body-2', 'body-3'])
  })
})
