// packages/lib/src/workflow-engine/catalog/__tests__/graph-hydration.test.ts

/**
 * `hydrateGraph` / `dehydrateGraph` — plan 23 §6's invariants, plus every trap
 * in §5 pinned as a test so a later refactor cannot quietly re-open one.
 *
 * The load-bearing properties, in order of blast radius:
 *
 *  1. **`dehydrate ∘ hydrate` is stable.** `graph-edit/ops.ts:288` decides "this
 *     agent mutation is a no-op" by hashing `cleanGraphForSave(workingGraph)`
 *     and comparing it to the hash of the STORED row. Break the inverse and
 *     that comparison never fires again, which revives the repeated-
 *     `update_node` edit loop #1701 fixed.
 *  2. **Hydration is a no-op on today's fat documents.** The read side ships
 *     first (§6), while the save path still writes fat documents — so the
 *     rollout is behaviour-neutral only if hydrating a document today's
 *     builder wrote returns it unchanged.
 *  3. **No stored key starts with `_` at any document level.** `edge._waitingRun`
 *     is in 16 stored edges including two published versions, because the old
 *     strip was scoped to `node.data`/`edge.data` and nowhere else (§3.1).
 */

import { describe, expect, it } from 'vitest'
import type { DraftGraph } from '../../../workflows/graph-edit/types'
import { validateGraphStructure } from '../../../workflows/graph-edit/validate'
import {
  dehydrateGraph,
  type GraphDocument,
  type GraphEdgeDocument,
  type GraphNodeDocument,
  hydrateGraph,
} from '../graph-hydration'
import { buildUpstreamMap, type EdgeMeta, type NodeMeta } from '../graph-vars'
import { DEHYDRATION_OPTIONS } from '../hydration-policy'
import { getManifest } from '../registry'

// ── fixtures ────────────────────────────────────────────────────────────────

/**
 * Node data as the canvas persists it TODAY: the manifest defaults the node
 * factory copied in at creation, plus the bookkeeping literals both writers
 * hardcode. Built from `defaultData()` rather than hand-listed so the fat
 * fixture stays a genuine "every default already present" document as
 * manifests evolve.
 */
function fatData(type: string, id: string, title: string, extra: Record<string, unknown> = {}) {
  return {
    ...((getManifest(type)?.defaultData() ?? {}) as Record<string, unknown>),
    id,
    type,
    title,
    isValid: true,
    errors: [],
    selected: false,
    ...extra,
  }
}

/**
 * A document in the shape a builder save writes today: `initializeWorkflow`'s
 * derivations baked in, React Flow interaction state persisted, explicit
 * handles, `extent` on the loop child.
 *
 * Shape: `t1 (resource-trigger) → l1 (loop)`, with `c1 → c2` inside `l1` and
 * `c2 --loop-back--> l1` closing the iteration.
 */
function fatGraph(): GraphDocument {
  const nodes: GraphNodeDocument[] = [
    {
      id: 't1',
      type: 'standard',
      position: { x: 0, y: 0 },
      width: 244,
      height: 90,
      selected: true,
      dragging: false,
      measured: { width: 244, height: 90 },
      data: fatData('resource-trigger', 't1', 'Record Created', {
        entityDefinitionId: 'contact',
      }),
    },
    {
      id: 'l1',
      type: 'standard',
      position: { x: 400, y: 0 },
      width: 600,
      height: 400,
      selected: false,
      data: fatData('loop', 'l1', 'Loop'),
    },
    {
      id: 'c1',
      type: 'standard',
      position: { x: 40, y: 60 },
      parentId: 'l1',
      extent: 'parent',
      width: 244,
      height: 90,
      selected: false,
      data: fatData('http', 'c1', 'Fetch page', { isInLoop: true, loopId: 'l1' }),
    },
    {
      id: 'c2',
      type: 'standard',
      position: { x: 320, y: 60 },
      parentId: 'l1',
      extent: 'parent',
      width: 244,
      height: 90,
      selected: false,
      data: fatData('code', 'c2', 'Transform', { isInLoop: true, loopId: 'l1' }),
    },
    {
      id: 'n1',
      type: 'note',
      position: { x: 0, y: 400 },
      selected: false,
      data: fatData('note', 'n1', 'Reminder'),
    },
  ]

  const edges: GraphEdgeDocument[] = [
    {
      id: 'e-t1-l1',
      source: 't1',
      target: 'l1',
      sourceHandle: 'source',
      targetHandle: 'target',
      zIndex: 0,
      data: { sourceType: 'resource-trigger', targetType: 'loop' },
    },
    {
      id: 'e-l1-c1',
      source: 'l1',
      target: 'c1',
      sourceHandle: 'loop-start',
      targetHandle: 'target',
      zIndex: 0,
      data: { sourceType: 'loop', targetType: 'http' },
    },
    {
      id: 'e-c1-c2',
      source: 'c1',
      target: 'c2',
      sourceHandle: 'source',
      targetHandle: 'target',
      zIndex: 0,
      data: { sourceType: 'http', targetType: 'code', isInLoop: true, loopId: 'l1' },
    },
    {
      id: 'e-c2-l1',
      source: 'c2',
      target: 'l1',
      sourceHandle: 'source',
      targetHandle: 'loop-back',
      zIndex: 0,
      data: { sourceType: 'code', targetType: 'loop', isLoopBackEdge: true },
    },
  ]

  return { nodes, edges, viewport: { x: 12, y: 34, zoom: 0.75 } }
}

/**
 * A graph as `graph-edit/ops.ts` mints it: no `edge.data` at all, no `zIndex`,
 * no `targetHandle`, `data.type` set, `node.type` already `'standard'`.
 */
function kopilotGraph(): DraftGraph {
  return {
    nodes: [
      {
        id: 'k-trigger',
        type: 'standard',
        position: { x: 0, y: 0 },
        width: 244,
        height: 90,
        selected: false,
        data: {
          id: 'k-trigger',
          type: 'manual',
          title: 'Manual trigger',
          desc: 'Run on demand',
          isValid: true,
          errors: [],
          disabled: false,
          selected: false,
        },
      },
      {
        id: 'k-http',
        type: 'standard',
        position: { x: 320, y: 0 },
        width: 244,
        height: 90,
        selected: false,
        data: {
          ...((getManifest('http')?.defaultData() ?? {}) as Record<string, unknown>),
          id: 'k-http',
          type: 'http',
          title: 'Call API',
          desc: 'HTTP request',
          isValid: true,
          errors: [],
          disabled: false,
          selected: false,
        },
      },
    ],
    edges: [{ id: 'k-e1', source: 'k-trigger', target: 'k-http', sourceHandle: 'source' }],
  } as unknown as DraftGraph
}

/** A minimal loop, with the loop-back edge's shape chosen by the caller. */
function loopGraph(opts: { loopBackHandle: boolean; childParented: boolean }): GraphDocument {
  return {
    nodes: [
      {
        id: 'l1',
        type: 'standard',
        position: { x: 0, y: 0 },
        data: { type: 'loop', title: 'Loop' },
      },
      {
        id: 'body',
        type: 'standard',
        position: { x: 40, y: 60 },
        ...(opts.childParented ? { parentId: 'l1' } : {}),
        data: { type: 'code', title: 'Body' },
      },
    ],
    edges: [
      { id: 'e-in', source: 'l1', target: 'body', sourceHandle: 'loop-start' },
      {
        id: 'e-back',
        source: 'body',
        target: 'l1',
        sourceHandle: 'source',
        ...(opts.loopBackHandle ? { targetHandle: 'loop-back' } : {}),
      },
    ],
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────

/**
 * The §1.2 "strip and do NOT re-derive" set — by definition invisible to any
 * reader, which is why the §6 round trip is stated as "loses nothing a reader
 * can observe" rather than as byte equality.
 *
 * Hydration deliberately does NOT strip these: the read side ships before the
 * write side, and hydration has to be a no-op against today's fat documents.
 * So they survive `hydrate(g)` and are gone from `hydrate(dehydrate(g))`, and
 * the comparison has to quotient them out.
 */
const UNOBSERVABLE_KEYS = new Set([
  'selected',
  'dragging',
  'resizing',
  'selectable',
  'focusable',
  'deletable',
  'draggable',
  'measured',
  'positionAbsolute',
  'isValid',
  'errors',
  'outputVariables',
  '$comment',
])

/** Drop the unobservable set from every node/edge object and their `data`. */
function observable(graph: GraphDocument): GraphDocument {
  const clean = (record: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(record).filter(([key]) => !UNOBSERVABLE_KEYS.has(key) && !key.startsWith('_'))
    )
  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      const out = clean(node) as GraphNodeDocument
      if (node.data) out.data = clean(node.data)
      return out
    }),
    edges: graph.edges.map((edge) => {
      const out = clean(edge) as GraphEdgeDocument
      if (edge.data) out.data = clean(edge.data)
      return out
    }),
  }
}

/**
 * Every key at the five levels the `_` rule owns: the graph object, each node
 * and edge object, and each `data` object.
 *
 * Deliberately NOT a deep walk — `dehydrateGraph` never descends into an
 * authored config value, because an HTTP node's `bodyJson` may legitimately
 * carry `{"_id": …}` and that is the user's payload, not our bookkeeping.
 */
function documentKeys(graph: GraphDocument): string[] {
  const keys = Object.keys(graph)
  for (const node of graph.nodes) {
    keys.push(...Object.keys(node), ...Object.keys(node.data ?? {}))
  }
  for (const edge of graph.edges) {
    keys.push(...Object.keys(edge), ...Object.keys(edge.data ?? {}))
  }
  return keys
}

const node = (graph: GraphDocument, id: string) => graph.nodes.find((n) => n.id === id)!
const edge = (graph: GraphDocument, id: string) => graph.edges.find((e) => e.id === id)!

// ── the invariants (§6) ─────────────────────────────────────────────────────

describe('the §6 invariants', () => {
  const cases: Array<[string, GraphDocument]> = [
    ['a fat builder document', fatGraph()],
    ['a Kopilot-authored graph', kopilotGraph() as unknown as GraphDocument],
    ['a loop wired by handle', loopGraph({ loopBackHandle: true, childParented: false })],
    ['a loop wired by containment', loopGraph({ loopBackHandle: false, childParented: true })],
    ['an empty graph', { nodes: [], edges: [] }],
    [
      'a node carrying no type at either level',
      {
        nodes: [{ id: 'x', position: { x: 0, y: 0 }, data: { title: 'X' } }],
        edges: [{ id: 'e', source: 'x', target: 'x' }],
      } as GraphDocument,
    ],
  ]

  it.each(cases)('hydrate is idempotent — %s', (_name, graph) => {
    const once = hydrateGraph(graph)
    expect(hydrateGraph(once)).toEqual(once)
  })

  it.each(cases)('dehydrate is idempotent — %s', (_name, graph) => {
    const once = dehydrateGraph(graph)
    expect(dehydrateGraph(once)).toEqual(once)
  })

  it.each(cases)('the round trip loses nothing a reader can observe — %s', (_name, graph) => {
    const hydrated = hydrateGraph(graph)
    const roundTripped = hydrateGraph(dehydrateGraph(hydrated))
    expect(observable(roundTripped)).toEqual(observable(hydrated))
  })

  it.each(cases)('dehydrate ∘ hydrate is STABLE — %s', (_name, graph) => {
    // The property `graph-edit/ops.ts:288` depends on: load a stored document,
    // hydrate it, change nothing, dehydrate it back — and get the stored
    // document byte for byte, so the no-op short-circuit fires.
    const stored = dehydrateGraph(hydrateGraph(graph))
    expect(dehydrateGraph(hydrateGraph(stored))).toEqual(stored)
  })

  it.each(cases)('no stored key starts with `_` at any document level — %s', (_name, graph) => {
    const stored = dehydrateGraph(hydrateGraph(graph))
    expect(documentKeys(stored).filter((key) => key.startsWith('_'))).toEqual([])
  })
})

describe('§3.1 — the `_` rule at every level, not just `data`', () => {
  it('strips `_` keys off the node and edge OBJECTS, which the old strip missed', () => {
    const graph: GraphDocument = {
      nodes: [
        {
          id: 'a',
          type: 'standard',
          position: { x: 0, y: 0 },
          _isBundled: true,
          data: { type: 'code', title: 'A', _targetBranches: [{ id: 'source' }] },
        },
      ],
      // `edge._waitingRun` is in 16 stored edges, two of them published.
      edges: [
        { id: 'e', source: 'a', target: 'a', _waitingRun: true, data: { _runningStatus: 'x' } },
      ],
      _scratch: 'canvas junk',
    }
    const stored = dehydrateGraph(graph)
    expect(stored).not.toHaveProperty('_scratch')
    expect(stored.nodes[0]).not.toHaveProperty('_isBundled')
    expect(stored.nodes[0]?.data).not.toHaveProperty('_targetBranches')
    expect(stored.edges[0]).not.toHaveProperty('_waitingRun')
    expect(documentKeys(stored).filter((k) => k.startsWith('_'))).toEqual([])
  })

  it('does NOT descend into an authored config value', () => {
    const graph: GraphDocument = {
      nodes: [
        {
          id: 'a',
          type: 'standard',
          position: { x: 0, y: 0 },
          data: { type: 'http', title: 'A', bodyJson: { _id: 'mongo-ish', nested: { _x: 1 } } },
        },
      ],
      edges: [],
    }
    expect(dehydrateGraph(graph).nodes[0]?.data?.bodyJson).toEqual({
      _id: 'mongo-ish',
      nested: { _x: 1 },
    })
  })

  it('strips `$comment` off node and edge objects, not just `node.data`', () => {
    const graph: GraphDocument = {
      nodes: [
        {
          id: 'a',
          type: 'standard',
          position: { x: 0, y: 0 },
          $comment: 'template authoring note',
          data: { type: 'code', title: 'A', $comment: 'inner' },
        },
      ],
      edges: [{ id: 'e', source: 'a', target: 'a', $comment: 'wire note' }],
    }
    const stored = dehydrateGraph(graph)
    expect(stored.nodes[0]).not.toHaveProperty('$comment')
    expect(stored.nodes[0]?.data).not.toHaveProperty('$comment')
    expect(stored.edges[0]).not.toHaveProperty('$comment')
  })
})

// ── hydration is behaviour-neutral on today's data ──────────────────────────

describe('hydration on a document today’s builder wrote', () => {
  it('is a no-op', () => {
    const fat = fatGraph()
    expect(hydrateGraph(fat)).toEqual(fat)
  })

  it('does not mutate its input', () => {
    const fat = fatGraph()
    const snapshot = structuredClone(fat)
    hydrateGraph(fat)
    dehydrateGraph(fat)
    expect(fat).toEqual(snapshot)
  })

  it('rewrites a sequence-compiled `node.type` to `standard` — the 870-row surprise', () => {
    // 870 sequence-generated nodes store REAL engine types at `node.type`. All
    // 870 also carry a matching `data.type` and every engine reader is
    // `data.type || node.type`, so this is inert — but a round-trip check over
    // dev shows 870 rows changing, and that is not a bug.
    const graph: GraphDocument = {
      nodes: [
        { id: 's1', type: 'wait', position: { x: 0, y: 0 }, data: { type: 'wait', title: 'Wait' } },
      ],
      edges: [],
    }
    const hydrated = hydrateGraph(graph)
    expect(node(hydrated, 's1').type).toBe('standard')
    expect(node(hydrated, 's1').data?.type).toBe('wait')
  })

  it('keeps `data.type` when only `node.type` carried it, so the publish gate can read it', () => {
    // `workflow-version-service.ts toEngineFormat` reads `node.data?.type` with
    // NO `node.type` fallback — so the type must land in `data` before
    // dehydration drops `node.type`.
    const graph: GraphDocument = {
      nodes: [{ id: 's1', type: 'wait', position: { x: 0, y: 0 }, data: { title: 'Wait' } }],
      edges: [],
    }
    expect(node(hydrateGraph(graph), 's1').data?.type).toBe('wait')
  })

  it('keeps an unrecoverable `node.type` rather than losing it', () => {
    const graph: GraphDocument = {
      nodes: [{ id: 's1', type: 'wait', position: { x: 0, y: 0 } }],
      edges: [],
    }
    expect(node(dehydrateGraph(graph), 's1').type).toBe('wait')
  })
})

// ── what hydration derives (§1.1) ───────────────────────────────────────────

describe('hydrateGraph derives', () => {
  const bare: GraphDocument = {
    nodes: [
      { id: 'l1', type: 'standard', position: { x: 0, y: 0 }, data: { type: 'loop', title: 'L' } },
      {
        id: 'c1',
        type: 'standard',
        position: { x: 10, y: 10 },
        parentId: 'l1',
        data: { type: 'code', title: 'C' },
      },
      { id: 'n1', type: 'standard', position: { x: 0, y: 9 }, data: { type: 'note', title: 'N' } },
    ],
    edges: [{ id: 'e1', source: 'l1', target: 'c1' }],
  }

  const hydrated = hydrateGraph(bare)

  it('`node.type` from `data.type`, mapped to standard/note', () => {
    expect(node(hydrated, 'c1').type).toBe('standard')
    expect(node(hydrated, 'n1').type).toBe('note')
  })

  it('`node.extent = parent` for every node with a parentId — which the initializer never rebuilt', () => {
    expect(node(hydrated, 'c1').extent).toBe('parent')
    expect(node(hydrated, 'l1')).not.toHaveProperty('extent')
  })

  it('`node.data.id` from `node.id`', () => {
    expect(node(hydrated, 'c1').data?.id).toBe('c1')
  })

  it('`node.data.isInLoop` / `loopId` from the top-level parentId and the parent’s type', () => {
    expect(node(hydrated, 'c1').data?.isInLoop).toBe(true)
    expect(node(hydrated, 'c1').data?.loopId).toBe('l1')
    expect(node(hydrated, 'l1').data).not.toHaveProperty('isInLoop')
  })

  it('never writes `parentId` INSIDE node.data (plan 22 §8.3)', () => {
    for (const n of hydrated.nodes) expect(n.data).not.toHaveProperty('parentId')
  })

  it('`edge.data.sourceType` / `targetType` from the endpoint nodes', () => {
    expect(edge(hydrated, 'e1').data).toMatchObject({ sourceType: 'loop', targetType: 'code' })
  })

  it('the handle defaults', () => {
    expect(edge(hydrated, 'e1').sourceHandle).toBe('source')
    expect(edge(hydrated, 'e1').targetHandle).toBe('target')
  })

  it('`edge.zIndex` via calculateZIndex', () => {
    expect(edge(hydrated, 'e1').zIndex).toBe(0)
  })

  it('is authoritative: a stale derived value it cannot re-derive is DELETED', () => {
    // This is the one behavioural difference from `initializeWorkflow`, which
    // only ever set these keys — and it is what makes dehydrate an exact
    // inverse rather than an approximate one.
    const stale: GraphDocument = {
      nodes: [
        {
          id: 'a',
          type: 'standard',
          position: { x: 0, y: 0 },
          extent: 'parent',
          data: { type: 'code', title: 'A', isInLoop: true, loopId: 'gone' },
        },
      ],
      edges: [
        {
          id: 'e',
          source: 'a',
          target: 'a',
          data: { isLoopBackEdge: true, isInLoop: true, loopId: 'gone' },
        },
      ],
    }
    const out = hydrateGraph(stale)
    expect(out.nodes[0]?.data).not.toHaveProperty('isInLoop')
    expect(out.nodes[0]?.data).not.toHaveProperty('loopId')
    expect(out.nodes[0]).not.toHaveProperty('extent')
    expect(out.edges[0]?.data).not.toHaveProperty('isLoopBackEdge')
    expect(out.edges[0]?.data).not.toHaveProperty('isInLoop')
  })
})

// ── the loop arm ────────────────────────────────────────────────────────────

describe('the loop arm', () => {
  it('re-flags a loop-back edge from `targetHandle === "loop-back"` alone', () => {
    const hydrated = hydrateGraph(loopGraph({ loopBackHandle: true, childParented: false }))
    expect(edge(hydrated, 'e-back').data?.isLoopBackEdge).toBe(true)
  })

  it('re-flags a loop-back edge from containment alone', () => {
    const hydrated = hydrateGraph(loopGraph({ loopBackHandle: false, childParented: true }))
    expect(edge(hydrated, 'e-back').data?.isLoopBackEdge).toBe(true)
  })

  it('does not flag a plain edge into a non-loop node', () => {
    const graph: GraphDocument = {
      nodes: [
        { id: 'a', type: 'standard', position: { x: 0, y: 0 }, data: { type: 'code', title: 'A' } },
        { id: 'b', type: 'standard', position: { x: 9, y: 0 }, data: { type: 'code', title: 'B' } },
      ],
      edges: [{ id: 'e', source: 'a', target: 'b' }],
    }
    expect(hydrateGraph(graph).edges[0]?.data).not.toHaveProperty('isLoopBackEdge')
  })

  it('marks an edge in-loop only when BOTH endpoints sit in the SAME loop', () => {
    const fat = hydrateGraph(fatGraph())
    expect(edge(fat, 'e-c1-c2').data).toMatchObject({ isInLoop: true, loopId: 'l1' })
    // c2 → l1 crosses the container boundary: the loop node itself is not in
    // the loop, so the edge is a loop-back, not an in-loop edge.
    expect(edge(fat, 'e-c2-l1').data).not.toHaveProperty('isInLoop')
    expect(edge(fat, 'e-c2-l1').data?.isLoopBackEdge).toBe(true)
  })

  it('survives the write/read round trip, and `graph-vars` still filters the cycle', () => {
    for (const shape of [
      { loopBackHandle: true, childParented: false },
      { loopBackHandle: false, childParented: true },
    ]) {
      const roundTripped = hydrateGraph(dehydrateGraph(hydrateGraph(loopGraph(shape))))
      expect(edge(roundTripped, 'e-back').data?.isLoopBackEdge).toBe(true)

      const upstream = buildUpstreamMap(
        roundTripped.edges as unknown as EdgeMeta[],
        roundTripped.nodes as unknown as NodeMeta[]
      )
      // Without the flag, `body → l1` closes a cycle and the loop container
      // reads as downstream of its own body.
      expect(upstream.get('l1')?.has('body')).toBe(false)
      expect(upstream.get('body')?.has('l1')).toBe(true)
    }
  })
})

// ── the read-time defaults layer: DELETED ──────────────────────────────────

/**
 * `23` §2.4's read-time `manifest.defaultData()` projection was built, never
 * enabled, and is gone — see `hydration-policy.ts` for the two structural
 * reasons (no single manifest lookup across seams; four non-deterministic
 * `defaultData()`s) and `26-hydration-defaults-and-handles.md` for the full
 * evaluation.
 *
 * What survives from that block is the part that was never about the layer: a
 * node's stored data is the whole of its content, and an unresolvable node type
 * passes through untouched.
 */
describe('stored data is the whole of a node’s content', () => {
  const stripped: GraphDocument = {
    nodes: [
      {
        id: 't1',
        type: 'standard',
        position: { x: 0, y: 0 },
        data: { id: 't1', type: 'resource-trigger', title: 'Record Created' },
      },
    ],
    edges: [],
  }

  it('does not invent config a node never stored', () => {
    // The layer used to answer `'contact'`/`'created'` here. It no longer does,
    // and the resource-trigger panel's mount backfill is what fills these in —
    // save-neutral, because plan 22's content guard sees no semantic change.
    const data = node(hydrateGraph(stripped), 't1').data!
    expect(data).not.toHaveProperty('resourceType')
    expect(data).not.toHaveProperty('operation')
    expect(data).not.toHaveProperty('filters')
  })

  it('round-trips an authored value unchanged even when it equals a manifest default', () => {
    // THE regression that made the layer's inverse unsafe: `resource-trigger`'s
    // default operation is `'created'`, so a user who CHOSE "created" was
    // byte-identical to one who never chose, and the strip deleted the key —
    // dropping `Workflow.triggerType` to a value no dispatcher matches.
    const authored = structuredClone(stripped)
    authored.nodes[0]!.data!.resourceType = 'contact'
    authored.nodes[0]!.data!.operation = 'created'
    authored.nodes[0]!.data!.entityDefinitionId = 'clq1abc123'

    const stored = dehydrateGraph(hydrateGraph(authored), DEHYDRATION_OPTIONS)
    expect(node(stored, 't1').data).toMatchObject({
      resourceType: 'contact',
      operation: 'created',
      entityDefinitionId: 'clq1abc123',
    })
  })

  it('leaves a node type it cannot resolve untouched', () => {
    const graph: GraphDocument = {
      nodes: [
        {
          id: 'a',
          type: 'standard',
          position: { x: 0, y: 0 },
          data: { id: 'a', type: 'some-app:some-block', title: 'App block', foo: 1 },
        },
      ],
      edges: [],
    }
    expect(node(hydrateGraph(graph), 'a').data).toEqual({
      id: 'a',
      type: 'some-app:some-block',
      title: 'App block',
      foo: 1,
    })
  })
})

// ── what dehydration strips, and what it must not (§1.2 / §1.3 / §5) ────────

describe('dehydrateGraph strips', () => {
  const stored = dehydrateGraph(hydrateGraph(fatGraph()))

  it('everything hydration re-derives', () => {
    expect(node(stored, 'c1')).not.toHaveProperty('extent')
    expect(node(stored, 'c1')).not.toHaveProperty('type')
    expect(node(stored, 'c1').data).not.toHaveProperty('id')
    expect(node(stored, 'c1').data).not.toHaveProperty('isInLoop')
    expect(node(stored, 'c1').data).not.toHaveProperty('loopId')
    expect(edge(stored, 'e-c1-c2')).not.toHaveProperty('zIndex')
    // `edge.data` held nothing but derived keys, so the key itself goes —
    // matching `cleanGraphForSave`, which set it to `undefined` for the same
    // reason. An empty `data: {}` is not a canonical shape.
    expect(edge(stored, 'e-c1-c2')).not.toHaveProperty('data')
  })

  it('the strip-and-do-NOT-re-derive set', () => {
    for (const n of stored.nodes) {
      expect(n.data).not.toHaveProperty('isValid')
      expect(n.data).not.toHaveProperty('errors')
      expect(n.data).not.toHaveProperty('selected')
      expect(n.data).not.toHaveProperty('outputVariables')
    }
  })

  it('React Flow interaction state on both nodes and edges', () => {
    for (const n of stored.nodes) {
      expect(n).not.toHaveProperty('selected')
      expect(n).not.toHaveProperty('dragging')
      expect(n).not.toHaveProperty('measured')
    }
    const withState: GraphDocument = {
      nodes: [],
      edges: [{ id: 'e', source: 'a', target: 'b', selected: true, focusable: false }],
    }
    expect(dehydrateGraph(withState).edges[0]).toEqual({ id: 'e', source: 'a', target: 'b' })
  })

  it('`data.selected` even when it disagrees with the top-level flag — no reconciling', () => {
    const graph: GraphDocument = {
      nodes: [
        {
          id: 'a',
          type: 'standard',
          position: { x: 0, y: 0 },
          selected: false,
          data: { type: 'code', title: 'A', selected: true },
        },
      ],
      edges: [],
    }
    const out = dehydrateGraph(graph)
    expect(out.nodes[0]).not.toHaveProperty('selected')
    expect(out.nodes[0]?.data).not.toHaveProperty('selected')
  })
})

describe('dehydrateGraph must NOT strip', () => {
  const stored = dehydrateGraph(hydrateGraph(fatGraph()))

  it('top-level `parentId` — the INPUT every containment derivation reads', () => {
    expect(node(stored, 'c1').parentId).toBe('l1')
    expect(node(hydrateGraph(stored), 'c1').data?.loopId).toBe('l1')
  })

  it('`width` / `height` — handleNodeResize writes an authored container size', () => {
    expect(node(stored, 'l1')).toMatchObject({ width: 600, height: 400 })
  })

  it('`position`, and `graph.viewport` — the authored starting view', () => {
    expect(node(stored, 'l1').position).toEqual({ x: 400, y: 0 })
    expect(stored.viewport).toEqual({ x: 12, y: 34, zoom: 0.75 })
  })

  it('`node.data.sourceType` — authored config on document-extractor, not the edge’s derived key', () => {
    // A NAME COLLISION, not the same field: the derived-key stripper is scoped
    // to `edge.data`. `'url'` rather than `'file'` so this test is about the
    // derived-key rule and not about the defaults layer (`file` IS
    // document-extractor's default — see the next test).
    const graph: GraphDocument = {
      nodes: [
        {
          id: 'd1',
          type: 'standard',
          position: { x: 0, y: 0 },
          data: {
            type: 'document-extractor',
            title: 'Extract',
            sourceType: 'url',
            targetType: 'x',
          },
        },
      ],
      edges: [{ id: 'e', source: 'd1', target: 'd1', data: { sourceType: 'document-extractor' } }],
    }
    const out = dehydrateGraph(graph)
    expect(out.nodes[0]?.data?.sourceType).toBe('url')
    expect(out.nodes[0]?.data?.targetType).toBe('x')
    expect(out.edges[0]).not.toHaveProperty('data')
  })

  it('an authored value that happens to EQUAL its manifest default', () => {
    // The read-time defaults layer used to drop this key on the theory that no
    // reader could tell. Readers could: "the user chose the default" and "the
    // user chose nothing" are different facts, and collapsing them is what
    // amputated a real row in #1771. Authored config is kept, full stop.
    //
    // `document-extractor`'s `sourceType` is also the name-collision trap:
    // `edge.data.sourceType` IS derived, `node.data.sourceType` is authored.
    const graph: GraphDocument = {
      nodes: [
        {
          id: 'd1',
          type: 'standard',
          position: { x: 0, y: 0 },
          data: { id: 'd1', type: 'document-extractor', title: 'Extract', sourceType: 'file' },
        },
      ],
      edges: [],
    }
    const stored = dehydrateGraph(hydrateGraph(graph), DEHYDRATION_OPTIONS)
    expect(stored.nodes[0]?.data?.sourceType).toBe('file')
  })

  it('`node.data.position` on form-input — a fractional run-form ORDER key, not a coordinate', () => {
    const graph: GraphDocument = {
      nodes: [
        {
          id: 'f1',
          type: 'standard',
          position: { x: 5, y: 5 },
          data: { type: 'form-input', title: 'Email', position: 'a1' },
        },
      ],
      edges: [],
    }
    expect(dehydrateGraph(graph).nodes[0]?.data?.position).toBe('a1')
  })

  it('`node.data.desc` and `node.data.collapsed` — authored content and a real user toggle', () => {
    const graph: GraphDocument = {
      nodes: [
        {
          id: 'a',
          type: 'standard',
          position: { x: 0, y: 0 },
          data: { type: 'code', title: 'A', desc: 'hand written', collapsed: true },
        },
      ],
      edges: [],
    }
    expect(dehydrateGraph(graph).nodes[0]?.data).toMatchObject({
      desc: 'hand written',
      collapsed: true,
    })
  })
})

// ── HR-1: the handle strip is BLOCKED, not merely qualified ─────────────────

describe('the default-handle strip', () => {
  const branchy: GraphDocument = {
    nodes: [],
    edges: [
      { id: 'plain', source: 'a', target: 'b', sourceHandle: 'source', targetHandle: 'target' },
      { id: 'case', source: 'a', target: 'c', sourceHandle: 'case_7x', targetHandle: 'target' },
      { id: 'back', source: 'c', target: 'l', sourceHandle: 'source', targetHandle: 'loop-back' },
      { id: 'fail', source: 'a', target: 'd', sourceHandle: 'fail', targetHandle: 'target' },
    ],
  }

  it('is OFF by default — `loop-execution-manager.ts:397` matches the RAW edge with no fallback', () => {
    const stored = dehydrateGraph(branchy)
    expect(edge(stored, 'plain').sourceHandle).toBe('source')
    expect(edge(stored, 'plain').targetHandle).toBe('target')
  })

  it('when explicitly enabled, drops ONLY the defaults', () => {
    const stored = dehydrateGraph(branchy, { stripDefaultHandles: true })
    expect(edge(stored, 'plain')).not.toHaveProperty('sourceHandle')
    expect(edge(stored, 'plain')).not.toHaveProperty('targetHandle')
    expect(edge(stored, 'case').sourceHandle).toBe('case_7x')
    expect(edge(stored, 'back').targetHandle).toBe('loop-back')
    expect(edge(stored, 'fail').sourceHandle).toBe('fail')
  })

  it('hydration restores them either way', () => {
    const hydrated = hydrateGraph(dehydrateGraph(branchy, { stripDefaultHandles: true }))
    expect(edge(hydrated, 'plain').sourceHandle).toBe('source')
    expect(edge(hydrated, 'plain').targetHandle).toBe('target')
    expect(edge(hydrated, 'case').sourceHandle).toBe('case_7x')
  })
})

// ── the Kopilot seam ────────────────────────────────────────────────────────

describe('a Kopilot-authored graph', () => {
  const lookup = getManifest

  it('survives dehydrate → hydrate with the same validate.ts verdict', () => {
    const authored = kopilotGraph()
    const before = validateGraphStructure(authored, { lookup })
    const roundTripped = hydrateGraph(
      dehydrateGraph(hydrateGraph(authored as unknown as GraphDocument))
    ) as unknown as DraftGraph
    const after = validateGraphStructure(roundTripped, { lookup })
    expect(after).toEqual(before)
  })

  it('gains the derivations it never carried, and none of them persist', () => {
    const hydrated = hydrateGraph(kopilotGraph() as unknown as GraphDocument)
    expect(edge(hydrated, 'k-e1').data).toMatchObject({ sourceType: 'manual', targetType: 'http' })
    expect(edge(hydrated, 'k-e1').zIndex).toBe(0)
    expect(edge(hydrated, 'k-e1').targetHandle).toBe('target')

    const stored = dehydrateGraph(hydrated)
    expect(edge(stored, 'k-e1')).not.toHaveProperty('data')
    expect(edge(stored, 'k-e1')).not.toHaveProperty('zIndex')
  })
})

// ── legacy normalization ────────────────────────────────────────────────────

describe('legacy app-trigger normalization', () => {
  it('rewrites `data.type: "app-trigger"` to the `appId:triggerId` keyspace', () => {
    const graph: GraphDocument = {
      nodes: [
        {
          id: 'a',
          type: 'standard',
          position: { x: 0, y: 0 },
          data: { type: 'app-trigger', appId: 'shopify', triggerId: 'order_created', title: 'T' },
        },
      ],
      edges: [],
    }
    expect(node(hydrateGraph(graph), 'a').data?.type).toBe('shopify:order_created')
  })

  it('leaves it alone when the ids are missing', () => {
    const graph: GraphDocument = {
      nodes: [
        { id: 'a', type: 'standard', position: { x: 0, y: 0 }, data: { type: 'app-trigger' } },
      ],
      edges: [],
    }
    expect(node(hydrateGraph(graph), 'a').data?.type).toBe('app-trigger')
  })
})

// ── malformed rows must degrade, never throw ────────────────────────────────

describe('a malformed stored row', () => {
  it('hydrates and dehydrates to an empty document instead of throwing', () => {
    // §4: a missed reader must not crash. A graph row with no `edges` key is a
    // legitimate legacy shape, and `buildGraph` is a mandatory engine seam.
    const broken = { nodes: undefined, edges: undefined } as unknown as GraphDocument
    expect(hydrateGraph(broken)).toMatchObject({ nodes: [], edges: [] })
    expect(dehydrateGraph(broken)).toMatchObject({ nodes: [], edges: [] })
  })
})
