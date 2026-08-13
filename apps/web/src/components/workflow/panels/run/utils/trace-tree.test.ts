// apps/web/src/components/workflow/panels/run/utils/trace-tree.test.ts

import { describe, expect, it } from 'vitest'
import type { FlowEdge, FlowNode } from '~/components/workflow/types'
import { NodeRunningStatus } from '~/components/workflow/types'
import {
  buildExecutionTree,
  treeToExecutions,
} from '~/components/workflow/utils/execution-tree-builder'
import { buildTraceTree, type TraceBranchItem, type TraceItem } from './trace-tree'

const node = (id: string, type: string, parentId?: string): FlowNode =>
  ({ id, type, position: { x: 0, y: 0 }, parentId, data: { type, title: id } }) as FlowNode

const edge = (source: string, target: string, sourceHandle = 'source'): FlowEdge =>
  ({ id: `${source}-${sourceHandle}-${target}`, source, target, sourceHandle }) as FlowEdge

/** Render the trace as an indented outline so nesting is asserted directly */
function outline(items: TraceItem[], indent = ''): string[] {
  return items.flatMap((item) =>
    item.type === 'node'
      ? [`${indent}${item.execution.nodeId}`]
      : [`${indent}[${item.branchId}]`, ...outline(item.children, `${indent}  `)]
  )
}

function branches(items: TraceItem[]): TraceBranchItem[] {
  return items.filter((i): i is TraceBranchItem => i.type === 'branch')
}

/**
 * trigger → gateA (if/else)
 *   true  → getOrder → gateB (if/else)
 *              true  → reply
 *              false → notFound
 *   false → ask
 */
const nestedGraph = {
  nodes: [
    node('trigger', 'manual'),
    node('gateA', 'if-else'),
    node('getOrder', 'http'),
    node('gateB', 'if-else'),
    node('reply', 'ai'),
    node('notFound', 'ai'),
    node('ask', 'ai'),
  ],
  edges: [
    edge('trigger', 'gateA'),
    edge('gateA', 'getOrder', 'true'),
    edge('gateA', 'ask', 'false'),
    edge('getOrder', 'gateB'),
    edge('gateB', 'reply', 'true'),
    edge('gateB', 'notFound', 'false'),
  ],
}

function traceOf(
  graph: { nodes: FlowNode[]; edges: FlowEdge[] },
  statuses: Record<string, NodeRunningStatus> = {},
  runFinished = false
) {
  const tree = buildExecutionTree(graph.nodes, graph.edges)
  const executions = new Map(
    Object.entries(statuses).map(([nodeId, status]) => [
      nodeId,
      { id: nodeId, nodeId, status, executionMetadata: {} } as any,
    ])
  )
  return buildTraceTree(treeToExecutions(tree, executions, graph.nodes), graph.nodes, runFinished)
}

describe('buildTraceTree', () => {
  it('nests a branch that opens inside another branch', () => {
    expect(outline(traceOf(nestedGraph))).toEqual([
      'trigger',
      'gateA',
      '[true]',
      '  getOrder',
      '  gateB',
      '  [true]',
      '    reply',
      '  [false]',
      '    notFound',
      '[false]',
      '  ask',
    ])
  })

  it('keeps the fork node itself outside the branches it opens', () => {
    const trace = traceOf(nestedGraph)
    expect(trace[0]).toMatchObject({ type: 'node', execution: { nodeId: 'trigger' } })
    // gateA forked, so it stays on the main line beside its two branches
    expect(branches(trace).map((b) => b.branchId)).toEqual(['true', 'false'])
  })

  it('rolls a nested failure up through every enclosing branch', () => {
    const trace = traceOf(nestedGraph, {
      trigger: NodeRunningStatus.Succeeded,
      gateA: NodeRunningStatus.Succeeded,
      getOrder: NodeRunningStatus.Succeeded,
      gateB: NodeRunningStatus.Succeeded,
      reply: NodeRunningStatus.Failed,
    })

    const outerTrue = branches(trace)[0] as TraceBranchItem
    expect(outerTrue.status).toBe(NodeRunningStatus.Failed)
    expect(branches(outerTrue.children)[0]?.status).toBe(NodeRunningStatus.Failed)
  })

  it('marks never-reached branches as skipped once the run finished', () => {
    const trace = traceOf(
      nestedGraph,
      {
        trigger: NodeRunningStatus.Succeeded,
        gateA: NodeRunningStatus.Succeeded,
        getOrder: NodeRunningStatus.Succeeded,
        gateB: NodeRunningStatus.Succeeded,
        reply: NodeRunningStatus.Succeeded,
      },
      true
    )

    const [outerTrue, outerFalse] = branches(trace)
    expect(outerTrue?.status).toBe(NodeRunningStatus.Succeeded)
    expect(outerFalse?.status).toBe(NodeRunningStatus.Skipped)
    // The inner false side never ran either
    expect(branches(outerTrue?.children ?? [])[1]?.status).toBe(NodeRunningStatus.Skipped)
  })

  it('numbers parallel branches leaving the same handle', () => {
    const graph = {
      nodes: [node('trigger', 'manual'), node('a', 'http'), node('b', 'http')],
      edges: [edge('trigger', 'a'), edge('trigger', 'b')],
    }

    expect(branches(traceOf(graph)).map((b) => [b.branchId, b.branchIndex])).toEqual([
      ['source', 0],
      ['source', 1],
    ])
  })

  it('leaves loop children out of the trace — they render in the loop card', () => {
    const graph = {
      nodes: [node('trigger', 'manual'), node('loop', 'loop'), node('inner', 'http', 'loop')],
      edges: [edge('trigger', 'loop'), edge('loop', 'inner')],
    }

    expect(outline(traceOf(graph))).toEqual(['trigger', 'loop'])
  })
})
