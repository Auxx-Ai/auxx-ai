// packages/lib/src/workflow-engine/catalog/graph-vars.test.ts

/**
 * `buildUpstreamHandleMap` and the `buildUpstreamMap` projection over it
 * (plan 24 §5).
 *
 * The load-bearing property is the PROJECTION PARITY: `buildUpstreamMap` was a
 * standalone reverse BFS and is now the key-set projection of the handle map,
 * so there is exactly one ancestry implementation. Anything that changes its
 * answers — most of all inside a residual cycle, where a topological
 * implementation silently returns an incomplete closure — is a regression in
 * every consumer at once.
 */

import { describe, expect, it } from 'vitest'
import {
  buildUpstreamHandleMap,
  buildUpstreamMap,
  type EdgeMeta,
  type NodeMeta,
} from './graph-vars'

const node = (id: string, type = 'crud'): NodeMeta => ({ id, type, data: { type } })

const edge = (source: string, target: string, sourceHandle?: string): EdgeMeta => ({
  id: `${source}->${target}${sourceHandle ? `:${sourceHandle}` : ''}`,
  source,
  target,
  ...(sourceHandle === undefined ? {} : { sourceHandle }),
})

/** `via[consumer][ancestor]` as a sorted array, for readable assertions. */
const handlesFor = (
  via: Map<string, Map<string, Set<string>>>,
  consumer: string,
  ancestor: string
): string[] => [...(via.get(consumer)?.get(ancestor) ?? [])].sort()

describe('buildUpstreamHandleMap', () => {
  it('records the ancestor’s OWN handle, transitively', () => {
    // Create --fail--> Log --source--> Notify
    // Notify reaches Create on `fail`, NOT on the `source` of the hop that got
    // there. Getting this backwards is the classic transitive-propagation bug.
    const nodes = [node('create'), node('log'), node('notify')]
    const edges = [edge('create', 'log', 'fail'), edge('log', 'notify', 'source')]

    const via = buildUpstreamHandleMap(edges, nodes)

    expect(handlesFor(via, 'log', 'create')).toEqual(['fail'])
    expect(handlesFor(via, 'notify', 'create')).toEqual(['fail'])
    expect(handlesFor(via, 'notify', 'log')).toEqual(['source'])
  })

  it('unions handles at a merge instead of letting one win', () => {
    //   create --source--> welcome --\
    //          --fail-----> logfail --+--> notify
    // `notify` is reachable from `create` on BOTH handles. Deduping on the
    // predecessor NODE rather than the edge is how the second handle gets lost.
    const nodes = [node('create'), node('welcome'), node('logfail'), node('notify')]
    const edges = [
      edge('create', 'welcome', 'source'),
      edge('create', 'logfail', 'fail'),
      edge('welcome', 'notify', 'source'),
      edge('logfail', 'notify', 'source'),
    ]

    const via = buildUpstreamHandleMap(edges, nodes)

    expect(handlesFor(via, 'welcome', 'create')).toEqual(['source'])
    expect(handlesFor(via, 'logfail', 'create')).toEqual(['fail'])
    expect(handlesFor(via, 'notify', 'create')).toEqual(['fail', 'source'])
  })

  it('unions handles on two direct edges between the same pair', () => {
    const nodes = [node('a'), node('b')]
    const edges = [edge('a', 'b', 'source'), edge('a', 'b', 'fail')]

    expect(handlesFor(buildUpstreamHandleMap(edges, nodes), 'b', 'a')).toEqual(['fail', 'source'])
  })

  it('defaults an absent sourceHandle to `source`', () => {
    const nodes = [node('a'), node('b'), node('c')]
    const edges = [edge('a', 'b'), { ...edge('b', 'c'), sourceHandle: null }]

    const via = buildUpstreamHandleMap(edges, nodes)

    expect(handlesFor(via, 'b', 'a')).toEqual(['source'])
    expect(handlesFor(via, 'c', 'b')).toEqual(['source'])
  })

  it('excludes loop-back edges, so a loop cannot widen a scope', () => {
    // Without the `getForwardEdges` filter the loop-back edge manufactures a
    // path from `body` back around to itself and the union widens to unscoped —
    // which is the easiest way to ship this feature and have it do nothing.
    const nodes = [node('trigger'), node('loop', 'loop'), node('body')]
    const edges: EdgeMeta[] = [
      edge('trigger', 'loop', 'source'),
      edge('loop', 'body', 'source'),
      { ...edge('body', 'loop', 'fail'), data: { isLoopBackEdge: true } },
    ]

    const via = buildUpstreamHandleMap(edges, nodes)

    expect(handlesFor(via, 'body', 'loop')).toEqual(['source'])
    expect(via.get('loop')?.has('body')).toBe(false)
  })

  it('ignores edges pointing at nodes outside the graph', () => {
    const nodes = [node('a'), node('b')]
    const edges = [edge('a', 'b', 'source'), edge('ghost', 'b', 'fail')]

    expect([...(buildUpstreamHandleMap(edges, nodes).get('b')?.keys() ?? [])]).toEqual(['a'])
  })
})

describe('buildUpstreamMap is the projection', () => {
  const expectProjection = (edges: EdgeMeta[], nodes: NodeMeta[]) => {
    const via = buildUpstreamHandleMap(edges, nodes)
    const upstream = buildUpstreamMap(edges, nodes)

    expect([...upstream.keys()]).toEqual([...via.keys()])
    for (const [consumer, ancestors] of via) {
      // Order too, not just membership: consumers iterate these sets.
      expect([...(upstream.get(consumer) ?? [])]).toEqual([...ancestors.keys()])
    }
    return upstream
  }

  it('matches on a branching graph', () => {
    const nodes = [node('create'), node('welcome'), node('logfail'), node('notify')]
    const edges = [
      edge('create', 'welcome', 'source'),
      edge('create', 'logfail', 'fail'),
      edge('welcome', 'notify', 'source'),
      edge('logfail', 'notify', 'source'),
    ]

    const upstream = expectProjection(edges, nodes)
    expect([...(upstream.get('notify') ?? [])].sort()).toEqual(['create', 'logfail', 'welcome'])
  })

  it('stays COMPLETE inside a hand-authored non-loop cycle', () => {
    // `topologicalSort` appends residual-cycle nodes at the end with a warning,
    // so a single forward pass in that order computes an INCOMPLETE closure.
    // The reverse BFS does not, and every node in a cycle is upstream of every
    // other. This is the test that catches a topological implementation.
    const nodes = [node('a'), node('b'), node('c')]
    const edges = [edge('a', 'b', 'source'), edge('b', 'c', 'source'), edge('c', 'a', 'fail')]

    const upstream = expectProjection(edges, nodes)

    for (const id of ['a', 'b', 'c']) {
      expect([...(upstream.get(id) ?? [])].sort(), `upstream of ${id}`).toEqual(['a', 'b', 'c'])
    }
    // And the handles survive the cycle rather than collapsing to `source`.
    expect(handlesFor(buildUpstreamHandleMap(edges, nodes), 'a', 'c')).toEqual(['fail'])
  })

  it('matches on a self-loop', () => {
    const nodes = [node('a')]
    expect([...(expectProjection([edge('a', 'a', 'fail')], nodes).get('a') ?? [])]).toEqual(['a'])
  })

  it('matches on a disconnected graph', () => {
    const nodes = [node('a'), node('b'), node('island')]
    const upstream = expectProjection([edge('a', 'b', 'source')], nodes)

    expect([...(upstream.get('island') ?? [])]).toEqual([])
    expect([...(upstream.get('a') ?? [])]).toEqual([])
  })

  it('matches on an empty graph', () => {
    expect(buildUpstreamMap([], []).size).toBe(0)
  })
})

describe('loop-node detection reads the authored type', () => {
  /**
   * A canvas-authored node: React Flow's renderer slot is `'standard'` and the
   * engine type lives in `data.type`. This is the shape 380 of the 1250 stored
   * dev nodes have, and it is what made the containment arm of
   * `getForwardEdges` unreachable when it read `node.type` alone.
   */
  const canvasNode = (id: string, type: string, parentId?: string): NodeMeta => ({
    id,
    type: 'standard',
    data: { type },
    ...(parentId === undefined ? {} : { parentId }),
  })

  it('filters a child→loop cycle even when the edge is not flagged', () => {
    const nodes = [
      canvasNode('L', 'loop'),
      canvasNode('c', 'crud', 'L'),
      canvasNode('after', 'crud'),
    ]
    // No `isLoopBackEdge` on the c->L edge: containment is the only signal.
    const edges = [edge('L', 'c', 'loop-start'), edge('c', 'L'), edge('L', 'after', 'loop-done')]

    const upstream = buildUpstreamMap(edges, nodes)

    // Without the fix `c` reaches itself through L and the cycle survives.
    expect([...(upstream.get('c') ?? [])].sort()).toEqual(['L'])
    expect([...(upstream.get('after') ?? [])].sort()).toEqual(['L'])
  })

  it('honours data.loopId as the containment signal too', () => {
    const nodes: NodeMeta[] = [
      canvasNode('L', 'loop'),
      { id: 'c', type: 'standard', data: { type: 'crud', loopId: 'L' } },
    ]
    const edges = [edge('L', 'c', 'loop-start'), edge('c', 'L')]

    expect([...(buildUpstreamMap(edges, nodes).get('c') ?? [])]).toEqual(['L'])
  })

  it('still keeps a plain edge into a non-loop node', () => {
    const nodes = [canvasNode('a', 'crud'), canvasNode('b', 'crud', 'a')]
    const edges = [edge('a', 'b'), edge('b', 'a')]

    // `a` is not a loop, so this is a hand-authored cycle and must stay COMPLETE.
    expect([...(buildUpstreamMap(edges, nodes).get('a') ?? [])].sort()).toEqual(['a', 'b'])
  })
})
