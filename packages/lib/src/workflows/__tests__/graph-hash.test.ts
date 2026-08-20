// packages/lib/src/workflows/__tests__/graph-hash.test.ts

import { stableStringify } from '@auxx/utils/json'
import { describe, expect, it } from 'vitest'
import {
  EPHEMERAL_EDGE_KEYS,
  EPHEMERAL_NODE_KEYS,
  hashGraphSemantics,
  hashWorkflowGraph,
  projectGraphSemantics,
} from '../graph-hash'

/**
 * The golden list of what IS and IS NOT authored content
 * (plans/kopilot/workflow/22 §4).
 *
 * `projectGraphSemantics` is the single definition of "did anyone actually
 * change this workflow?" — the server hashes it, the browser compares it as a
 * string before deciding a save is worth sending. Every row below is a real
 * write that happens on a stored graph today, and the question each one
 * answers is: should this alone be able to fire a save?
 *
 * The projection is deliberately NOT the CAS token. `hashWorkflowGraph` stays
 * whole-document over the raw stored row (plans/kopilot/workflow/23 §3.2), and
 * that contrast is pinned here so nobody "unifies" the two.
 */

/** `stableStringify` of the projection — what the browser will compare. */
const project = (graph: unknown): string => stableStringify(projectGraphSemantics(graph))

const same = (a: unknown, b: unknown): void => {
  expect(project(a)).toBe(project(b))
  expect(hashGraphSemantics(a)).toBe(hashGraphSemantics(b))
}

const differs = (a: unknown, b: unknown): void => {
  expect(project(a)).not.toBe(project(b))
  expect(hashGraphSemantics(a)).not.toBe(hashGraphSemantics(b))
}

/** A canonical, Kopilot-shaped document: no canvas state, no derivations. */
const baseGraph = () => ({
  nodes: [
    {
      id: 'manual-1',
      position: { x: 0, y: 0 },
      data: { type: 'manual', title: 'Manual trigger', desc: 'Kick it off' },
    },
    {
      id: 'wait-1',
      position: { x: 320, y: 0 },
      data: { type: 'wait', title: 'Wait', config: { duration: 5 } },
    },
  ],
  edges: [{ id: 'e1', source: 'manual-1', target: 'wait-1' }],
})

/** Same document, mutated through a callback on the first node. */
const withNode = (graph: ReturnType<typeof baseGraph>, patch: Record<string, unknown>) => ({
  ...graph,
  nodes: graph.nodes.map((n, i) => (i === 0 ? { ...n, ...patch } : n)),
})

const withNodeData = (graph: ReturnType<typeof baseGraph>, patch: Record<string, unknown>) => ({
  ...graph,
  nodes: graph.nodes.map((n, i) => (i === 0 ? { ...n, data: { ...n.data, ...patch } } : n)),
})

const withEdge = (graph: ReturnType<typeof baseGraph>, patch: Record<string, unknown>) => ({
  ...graph,
  edges: graph.edges.map((e) => ({ ...e, ...patch })),
})

describe('projectGraphSemantics — not content', () => {
  it('drops the viewport entirely', () => {
    same(baseGraph(), { ...baseGraph(), viewport: { x: -124.9, y: 70.25, zoom: 0.7123456789 } })
  })

  it('drops every React Flow interaction flag on a node', () => {
    same(
      baseGraph(),
      withNode(baseGraph(), {
        selected: true,
        dragging: false,
        resizing: false,
        selectable: true,
        focusable: true,
        deletable: true,
        draggable: true,
      })
    )
  })

  it('drops measurement writebacks: measured, positionAbsolute, top-level width/height', () => {
    same(
      baseGraph(),
      withNode(baseGraph(), {
        measured: { width: 244, height: 100 },
        positionAbsolute: { x: 0, y: 0 },
        width: 244,
        height: 100,
      })
    )
  })

  it('drops zIndex on nodes and on edges', () => {
    same(baseGraph(), withNode(baseGraph(), { zIndex: 1002 }))
    same(baseGraph(), withEdge(baseGraph(), { zIndex: 1002 }))
  })

  it('drops edge.selected and edge.animated', () => {
    same(baseGraph(), withEdge(baseGraph(), { selected: true, animated: true }))
  })

  it('drops node.type — the load path rebuilds it from data.type', () => {
    same(baseGraph(), withNode(baseGraph(), { type: 'standard' }))
  })

  it('drops the containment fields the load path re-derives from parentId', () => {
    same(baseGraph(), withNodeData(baseGraph(), { isInLoop: true, loopId: 'loop-1' }))
  })

  it('drops edge.data fields re-derived from the endpoint nodes', () => {
    same(
      baseGraph(),
      withEdge(baseGraph(), {
        data: {
          sourceType: 'manual',
          targetType: 'wait',
          isInLoop: true,
          loopId: 'loop-1',
          isLoopBackEdge: true,
        },
      })
    )
  })

  it('drops node.data fields that have never held information', () => {
    same(
      baseGraph(),
      withNodeData(baseGraph(), {
        isValid: true,
        errors: [],
        selected: false,
        outputVariables: [],
      })
    )
  })

  it('drops $comment left behind by the template transformer', () => {
    same(baseGraph(), withNode(baseGraph(), { $comment: 'the entry point' }))
    same(baseGraph(), withEdge(baseGraph(), { $comment: 'wires the trigger in' }))
  })

  it('treats an absent handle and the default handle as the same document', () => {
    same(baseGraph(), withEdge(baseGraph(), { sourceHandle: 'source', targetHandle: 'target' }))
    // An explicit null is the same absence.
    same(baseGraph(), withEdge(baseGraph(), { sourceHandle: null, targetHandle: null }))
  })

  it('a whole builder open — every derivation at once — is not a change', () => {
    const opened = {
      ...baseGraph(),
      viewport: { x: -124.9, y: 70.25, zoom: 0.7123456789 },
      nodes: baseGraph().nodes.map((n) => ({
        ...n,
        type: 'standard',
        selected: n.id === 'manual-1',
        dragging: false,
        width: 244,
        height: 100,
        measured: { width: 244, height: 100 },
        data: {
          ...n.data,
          isValid: true,
          errors: [],
          _connectedSourceHandleIds: ['source'],
          _connectedTargetHandleIds: ['target'],
          _targetBranches: [],
        },
      })),
      edges: baseGraph().edges.map((e) => ({
        ...e,
        sourceHandle: 'source',
        targetHandle: 'target',
        zIndex: 1002,
        data: { sourceType: 'manual', targetType: 'wait' },
      })),
    }
    same(baseGraph(), opened)
  })
})

describe('projectGraphSemantics — content', () => {
  it('keeps node.position — a drag is an edit', () => {
    differs(baseGraph(), withNode(baseGraph(), { position: { x: 40, y: 12 } }))
  })

  it('keeps parentId — authored containment, and the input hydration reads', () => {
    differs(baseGraph(), withNode(baseGraph(), { parentId: 'loop-1' }))
  })

  it('keeps a NON-default sourceHandle — a branch rewire can change nothing else', () => {
    const a = withEdge(baseGraph(), { sourceHandle: 'case_a1b2c3' })
    const b = withEdge(baseGraph(), { sourceHandle: 'case_z9y8x7' })
    differs(baseGraph(), a)
    differs(a, b)
  })

  it('keeps a NON-default targetHandle — loop-back routing is content', () => {
    differs(baseGraph(), withEdge(baseGraph(), { targetHandle: 'loop-back' }))
  })

  it('keeps every non-derived key under node.data', () => {
    differs(baseGraph(), withNodeData(baseGraph(), { title: 'Renamed by hand' }))
    differs(baseGraph(), withNodeData(baseGraph(), { desc: 'A new description' }))
    differs(baseGraph(), withNodeData(baseGraph(), { collapsed: true }))
    differs(baseGraph(), withNodeData(baseGraph(), { config: { duration: 6 } }))
  })

  it("keeps node.data.sourceType — it is document-extractor's authored config", () => {
    // The name collides with the DERIVED `edge.data.sourceType`. Scoping the
    // stripper to edges is what keeps a real config change visible.
    differs(baseGraph(), withNodeData(baseGraph(), { sourceType: 'url' }))
  })

  it("keeps form-input's data.position — a run-form ordering key, not a coordinate", () => {
    const a = withNodeData(baseGraph(), { position: 'a0' })
    const b = withNodeData(baseGraph(), { position: 'a1' })
    differs(a, b)
  })

  it('keeps the node and edge sets, and their ids', () => {
    const base = baseGraph()
    differs(base, { ...base, nodes: [...base.nodes, { ...base.nodes[0], id: 'brand-new' }] })
    differs(base, { ...base, edges: [] })
    differs(base, withNode(base, { id: 'renamed-node' }))
  })
})

describe('a container resize is content; a measurement writeback is not', () => {
  // `use-loop-config.ts` writes BOTH on auto-grow, and `handleNodeResize` writes
  // both on a real drag — so the projection has to key off the pair that only a
  // resize handler authors (plans/kopilot/workflow/22 R4).
  const loopGraph = () => ({
    nodes: [
      {
        id: 'loop-1',
        type: 'standard',
        position: { x: 0, y: 0 },
        width: 500,
        height: 300,
        data: { type: 'loop', title: 'Loop', width: 500, height: 300 },
      },
    ],
    edges: [],
  })

  it('a ResizeObserver writeback to top-level width/height does not change the projection', () => {
    const measured = {
      ...loopGraph(),
      nodes: loopGraph().nodes.map((n) => ({ ...n, width: 512, height: 318 })),
    }
    same(loopGraph(), measured)
  })

  it('a resize that authors data.width/data.height DOES change the projection', () => {
    const resized = {
      ...loopGraph(),
      nodes: loopGraph().nodes.map((n) => ({
        ...n,
        width: 640,
        height: 400,
        data: { ...n.data, width: 640, height: 400 },
      })),
    }
    differs(loopGraph(), resized)
  })
})

describe('no key starting with _ is content, at any level', () => {
  it('strips derived keys on the node OBJECT, not just node.data', () => {
    // The existing save-seam strip is scoped to `.data`, which is how
    // `edge._waitingRun` reached 16 stored edges and two published versions.
    same(baseGraph(), withNode(baseGraph(), { _isBundled: true, _runningStatus: 'running' }))
    same(baseGraph(), withEdge(baseGraph(), { _waitingRun: true }))
  })

  it('strips derived keys nested arbitrarily deep inside data', () => {
    const clean = withNodeData(baseGraph(), {
      config: { duration: 5, nested: { deeper: { keep: 1 } } },
    })
    const dirty = withNodeData(baseGraph(), {
      config: {
        duration: 5,
        _computedOutputs: [{ id: 'x', _hidden: true }],
        nested: { deeper: { keep: 1, _hiddenFields: ['a'] } },
      },
    })
    same(clean, dirty)
    // ...and the authored siblings all survived.
    differs(baseGraph(), clean)
  })

  it('an emptied data object equals an absent one', () => {
    // The load path writes `edge.data = { sourceType, targetType }` onto edges
    // a Kopilot-authored graph left with no `data` at all. Both keys are
    // derived, so what is left must compare equal to nothing.
    same(baseGraph(), withEdge(baseGraph(), { data: {} }))
    same(baseGraph(), withEdge(baseGraph(), { data: { _waitingRun: true } }))
  })

  it('leaves no _-prefixed key anywhere in the projection', () => {
    const dirty = withEdge(
      withNode(baseGraph(), {
        _isBundled: true,
        data: {
          type: 'manual',
          _targetBranches: [{ id: 'b', _tag: 1 }],
          config: { list: [{ _x: 1, keep: 2 }] },
        },
      }),
      { _waitingRun: true, data: { _tmp: true } }
    )
    expect(project(dirty)).not.toContain('"_')
  })
})

describe('the projection is not the CAS token', () => {
  it('hashWorkflowGraph stays whole-document — a viewport change IS a write conflict', () => {
    const base = baseGraph()
    const panned = { ...base, viewport: { x: 10, y: 20, zoom: 1.5 } }
    expect(hashGraphSemantics(panned)).toBe(hashGraphSemantics(base))
    expect(hashWorkflowGraph(panned)).not.toBe(hashWorkflowGraph(base))
  })

  it('hashGraphSemantics is exactly sha256(stableStringify(projection))', async () => {
    const { createHash } = await import('node:crypto')
    const expected = createHash('sha256')
      .update(stableStringify(projectGraphSemantics(baseGraph())), 'utf8')
      .digest('hex')
    expect(hashGraphSemantics(baseGraph())).toBe(expected)
  })
})

describe('degenerate input', () => {
  it('tolerates null, undefined and a graph with neither nodes nor edges', () => {
    expect(projectGraphSemantics(null)).toEqual({ nodes: [], edges: [] })
    expect(projectGraphSemantics(undefined)).toEqual({ nodes: [], edges: [] })
    expect(projectGraphSemantics({})).toEqual({ nodes: [], edges: [] })
    same(null, { nodes: [], edges: [] })
  })

  it('tolerates a null node or edge entry', () => {
    expect(projectGraphSemantics({ nodes: [null], edges: [null] })).toEqual({
      nodes: [{}],
      edges: [{}],
    })
  })

  it('exports the key sets it strips by', () => {
    expect(EPHEMERAL_NODE_KEYS.has('selected')).toBe(true)
    expect(EPHEMERAL_NODE_KEYS.has('type')).toBe(true)
    expect(EPHEMERAL_NODE_KEYS.has('position')).toBe(false)
    expect(EPHEMERAL_NODE_KEYS.has('parentId')).toBe(false)
    expect(EPHEMERAL_EDGE_KEYS.has('zIndex')).toBe(true)
    expect(EPHEMERAL_EDGE_KEYS.has('sourceHandle')).toBe(false)
  })
})
