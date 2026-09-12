// packages/lib/src/returns/__tests__/salvage-tree.test.ts

/**
 * `returns/salvage-tree.ts` - the lazy BOM view tree.
 *
 * **No doubles of any kind.** Every function under test takes plain data and
 * returns plain data, so the inputs here are real `Map`s and real row arrays,
 * built by the four helpers below. The interesting cases are the pathological
 * ones and they get most of the file: a cycle, a self-edge, a BOM deeper than
 * the cap, a part used in two branches, a split, and a row whose part is no
 * longer in the BOM at all.
 */

import { describe, expect, it } from 'vitest'
import { bomQuantity, buildSalvageTree, findSalvageNode, flattenSalvageTree } from '../salvage-tree'
import {
  DEFAULT_SALVAGE_PERCENT,
  MAX_SALVAGE_DEPTH,
  type MaterializedSalvageRow,
  ROOT_SALVAGE_KEY,
  type SalvageNode,
  type SalvagePartInfo,
  type SubpartGraph,
} from '../types'

/** `{ parent: [[child, qty], ...] }` as the adjacency map `loadSubpartGraph` returns. */
function graphOf(edges: Record<string, [string, number][]>): SubpartGraph {
  return new Map(
    Object.entries(edges).map(([parent, children]) => [
      parent,
      children.map(([childId, qty]) => ({ childId, qty })),
    ])
  )
}

/** A `return_part_line` row, top level and undecided unless overridden. */
function row(
  over: Partial<MaterializedSalvageRow> & Pick<MaterializedSalvageRow, 'id' | 'partId'>
): MaterializedSalvageRow {
  return {
    parentId: null,
    quantity: 1,
    status: 'undecided',
    salvagePercent: DEFAULT_SALVAGE_PERCENT,
    ...over,
  }
}

/** Part labels for every id named. */
function partsOf(...ids: string[]): Map<string, SalvagePartInfo> {
  return new Map(ids.map((id) => [id, { name: id.toUpperCase(), number: `P-${id}` }]))
}

/** `buildSalvageTree` with a one-lift return unless overridden. */
function tree(over: {
  graph: SubpartGraph
  rootPartId?: string
  returnLineQuantity?: number
  rows?: MaterializedSalvageRow[]
  parts?: Map<string, SalvagePartInfo>
}): SalvageNode[] {
  return buildSalvageTree({
    graph: over.graph,
    rootPartId: over.rootPartId ?? 'lift',
    returnLineQuantity: over.returnLineQuantity ?? 1,
    rows: over.rows ?? [],
    parts: over.parts ?? new Map(),
  })
}

// ============= bomQuantity =============

describe('bomQuantity', () => {
  it('returns the edge quantity', () => {
    expect(bomQuantity(graphOf({ lift: [['mast', 2]] }), 'lift', 'mast')).toBe(2)
  })

  it('returns null for a part that is not a child of the parent', () => {
    expect(bomQuantity(graphOf({ lift: [['mast', 2]] }), 'lift', 'bolt')).toBeNull()
  })

  it('returns null for a parent with no edges at all', () => {
    expect(bomQuantity(new Map(), 'lift', 'mast')).toBeNull()
  })

  it('sums parallel edges rather than taking the first', () => {
    const graph = graphOf({
      lift: [
        ['bolt', 3],
        ['bolt', 4],
      ],
    })
    expect(bomQuantity(graph, 'lift', 'bolt')).toBe(7)
  })
})

// ============= The empty and trivial cases =============

describe('buildSalvageTree, nothing to show', () => {
  it('returns no nodes for a part with an empty BOM', () => {
    expect(tree({ graph: new Map() })).toEqual([])
  })

  it('returns no nodes when the graph describes other parts only', () => {
    expect(tree({ graph: graphOf({ other: [['bolt', 1]] }) })).toEqual([])
  })

  it('emits a row whose part is not in the BOM at all rather than dropping it', () => {
    const nodes = tree({
      graph: new Map(),
      rows: [row({ id: 'r1', partId: 'ghost', quantity: 2, status: 'good' })],
    })
    expect(nodes.map((n) => n.key)).toEqual(['r1'])
    expect(nodes[0]?.status).toBe('good')
  })
})

// ============= The prefill rule =============

describe('the prefill rule', () => {
  it('prefills the top level at BOM quantity times the return line quantity', () => {
    // Two lifts back, each carrying 2 of the subassembly: the row says 4.
    const nodes = tree({
      graph: graphOf({ lift: [['mast', 2]] }),
      returnLineQuantity: 2,
    })
    expect(nodes).toHaveLength(1)
    expect(nodes[0]?.quantity).toBe(4)
  })

  it('compounds down the tree: a child prefills from its parent quantity', () => {
    // 2 lifts x 2 masts = 4 masts; each mast holds 3 bolts, so 12 bolts.
    const nodes = tree({
      graph: graphOf({ lift: [['mast', 2]], mast: [['bolt', 3]] }),
      returnLineQuantity: 2,
      rows: [row({ id: 'r1', partId: 'mast', quantity: 4 })],
    })
    expect(nodes[0]?.children?.[0]?.quantity).toBe(12)
  })

  it('prefills children from the EDITED parent quantity, not the BOM one', () => {
    // The warehouse found only 3 of the 4 masts: 3 x 3 = 9 bolts, not 12.
    const nodes = tree({
      graph: graphOf({ lift: [['mast', 2]], mast: [['bolt', 3]] }),
      returnLineQuantity: 2,
      rows: [row({ id: 'r1', partId: 'mast', quantity: 3 })],
    })
    expect(nodes[0]?.children?.[0]?.quantity).toBe(9)
  })

  it('sums parallel BOM edges into one prefilled row', () => {
    const nodes = tree({
      graph: graphOf({
        lift: [
          ['bolt', 3],
          ['bolt', 4],
        ],
      }),
      returnLineQuantity: 2,
    })
    expect(nodes).toHaveLength(1)
    expect(nodes[0]?.quantity).toBe(14)
  })
})

// ============= The laziness rule =============

describe('the laziness rule', () => {
  const deepGraph = graphOf({
    lift: [['mast', 1]],
    mast: [['cylinder', 2]],
    cylinder: [['seal', 4]],
  })

  it('shows the top level only when nothing is materialized', () => {
    const nodes = tree({ graph: deepGraph })
    expect(nodes).toHaveLength(1)
    expect(nodes[0]?.children).toBeNull()
    expect(nodes[0]?.hasChildren).toBe(true)
  })

  it('marks an unmaterialized node undecided by absence, at the default percent', () => {
    const node = tree({ graph: deepGraph })[0]
    expect(node?.materialized).toBe(false)
    expect(node?.status).toBe('undecided')
    expect(node?.salvagePercent).toBe(DEFAULT_SALVAGE_PERCENT)
  })

  it('keys an unmaterialized top-level node off the synthetic root key', () => {
    expect(tree({ graph: deepGraph })[0]?.key).toBe(`bom:${ROOT_SALVAGE_KEY}:mast`)
  })

  it('keys an unmaterialized child off its materialized parent row id', () => {
    const nodes = tree({ graph: deepGraph, rows: [row({ id: 'r1', partId: 'mast' })] })
    expect(nodes[0]?.children?.[0]?.key).toBe('bom:r1:cylinder')
  })

  it('expands exactly one level past a materialized node', () => {
    const nodes = tree({ graph: deepGraph, rows: [row({ id: 'r1', partId: 'mast' })] })
    const cylinder = nodes[0]?.children?.[0]
    expect(cylinder?.partId).toBe('cylinder')
    // The seal under it is NOT present: nobody has touched the cylinder.
    expect(cylinder?.children).toBeNull()
    expect(cylinder?.hasChildren).toBe(true)
  })

  it('expands every level that has a row, and no further', () => {
    const nodes = tree({
      graph: deepGraph,
      rows: [
        row({ id: 'r1', partId: 'mast' }),
        row({ id: 'r2', partId: 'cylinder', parentId: 'r1', quantity: 2 }),
      ],
    })
    const seal = nodes[0]?.children?.[0]?.children?.[0]
    expect(seal?.partId).toBe('seal')
    expect(seal?.children).toBeNull()
    // A leaf part offers no expander.
    expect(seal?.hasChildren).toBe(false)
  })

  it('gives a materialized leaf an empty child list, not a null one', () => {
    const nodes = tree({
      graph: graphOf({ lift: [['bolt', 1]] }),
      rows: [row({ id: 'r1', partId: 'bolt' })],
    })
    expect(nodes[0]?.children).toEqual([])
    expect(nodes[0]?.hasChildren).toBe(false)
  })
})

// ============= Materialized rows =============

describe('materialized rows', () => {
  it('takes quantity, status and percent from the row, and keys on its id', () => {
    const nodes = tree({
      graph: graphOf({ lift: [['mast', 2]] }),
      returnLineQuantity: 5,
      rows: [row({ id: 'r1', partId: 'mast', quantity: 7, status: 'good', salvagePercent: 60 })],
    })
    expect(nodes[0]).toMatchObject({
      key: 'r1',
      quantity: 7,
      status: 'good',
      salvagePercent: 60,
      materialized: true,
      depth: 0,
    })
  })

  it('replaces the synthetic node for that part rather than showing both', () => {
    const nodes = tree({
      graph: graphOf({ lift: [['mast', 2]] }),
      rows: [row({ id: 'r1', partId: 'mast' })],
    })
    expect(nodes).toHaveLength(1)
    expect(nodes[0]?.key).toBe('r1')
  })

  it('shows both halves of a split, ordered by sortOrder', () => {
    const nodes = tree({
      graph: graphOf({ lift: [['mast', 4]] }),
      rows: [
        row({ id: 'rb', partId: 'mast', quantity: 1, status: 'scrap', sortOrder: 'b' }),
        row({ id: 'ra', partId: 'mast', quantity: 3, status: 'good', sortOrder: 'a' }),
      ],
    })
    expect(nodes.map((n) => n.key)).toEqual(['ra', 'rb'])
    expect(nodes.map((n) => n.quantity)).toEqual([3, 1])
  })

  it('falls back to the row id when sortOrder is missing, so order is total', () => {
    const nodes = tree({
      graph: graphOf({ lift: [['mast', 4]] }),
      rows: [
        row({ id: 'r2', partId: 'mast', quantity: 1 }),
        row({ id: 'r1', partId: 'mast', quantity: 3 }),
      ],
    })
    expect(nodes.map((n) => n.key)).toEqual(['r1', 'r2'])
  })

  it('emits a row whose part left the parent BOM after the row was written, last', () => {
    const nodes = tree({
      graph: graphOf({ lift: [['mast', 1]] }),
      rows: [row({ id: 'r9', partId: 'retired', status: 'damaged' })],
    })
    expect(nodes.map((n) => n.partId)).toEqual(['mast', 'retired'])
    expect(nodes[1]?.materialized).toBe(true)
  })
})

// ============= Labels =============

describe('part labels', () => {
  it('carries the name and number from the parts map', () => {
    const nodes = tree({
      graph: graphOf({ lift: [['mast', 1]] }),
      parts: partsOf('mast'),
    })
    expect(nodes[0]?.partName).toBe('MAST')
    expect(nodes[0]?.partNumber).toBe('P-mast')
  })

  it('names an unknown part by its id rather than rendering blank', () => {
    const nodes = tree({ graph: graphOf({ lift: [['mast', 1]] }) })
    expect(nodes[0]?.partName).toBe('mast')
    expect(nodes[0]?.partNumber).toBeNull()
  })
})

// ============= Cycles and the depth cap =============

describe('cycles', () => {
  it('terminates on a two-part cycle and stops at the repeat', () => {
    const nodes = tree({
      graph: graphOf({ lift: [['a', 1]], a: [['b', 1]], b: [['a', 1]] }),
      rows: [
        row({ id: 'r1', partId: 'a' }),
        row({ id: 'r2', partId: 'b', parentId: 'r1' }),
        row({ id: 'r3', partId: 'a', parentId: 'r2' }),
      ],
    })
    const repeat = nodes[0]?.children?.[0]?.children?.[0]
    expect(repeat?.partId).toBe('a')
    expect(repeat?.children).toEqual([])
    expect(repeat?.hasChildren).toBe(false)
  })

  it('terminates on a self-edge, showing the repeat once and unexpandable', () => {
    const nodes = tree({
      graph: graphOf({ lift: [['a', 1]], a: [['a', 2]] }),
      rows: [row({ id: 'r1', partId: 'a' })],
    })
    const repeat = nodes[0]?.children?.[0]
    expect(repeat?.partId).toBe('a')
    expect(repeat?.hasChildren).toBe(false)
    expect(nodes[0]?.children).toHaveLength(1)
  })

  it('treats the returned part itself as on the path', () => {
    const nodes = tree({
      graph: graphOf({ lift: [['a', 1]], a: [['lift', 1]] }),
      rows: [row({ id: 'r1', partId: 'a' })],
    })
    expect(nodes[0]?.children?.[0]?.partId).toBe('lift')
    expect(nodes[0]?.children?.[0]?.hasChildren).toBe(false)
  })

  it('shows a part used in two branches twice, because they are graded separately', () => {
    const nodes = tree({
      graph: graphOf({
        lift: [
          ['mast', 1],
          ['base', 1],
        ],
        mast: [['bolt', 4]],
        base: [['bolt', 6]],
      }),
      rows: [row({ id: 'r1', partId: 'mast' }), row({ id: 'r2', partId: 'base' })],
    })
    const bolts = flattenSalvageTree(nodes).filter((n) => n.partId === 'bolt')
    expect(bolts).toHaveLength(2)
    expect(bolts.map((b) => b.quantity)).toEqual([4, 6])
    expect(new Set(bolts.map((b) => b.key)).size).toBe(2)
  })
})

describe('the depth cap', () => {
  /** `p0 -> p1 -> ... -> p{length}`, one of each. */
  function chainGraph(length: number): SubpartGraph {
    return graphOf(
      Object.fromEntries(
        Array.from({ length }, (_, i) => [`p${i}`, [[`p${i + 1}`, 1]] as [string, number][]])
      )
    )
  }

  it('stops at MAX_SALVAGE_DEPTH even when every level has a row', () => {
    const depth = MAX_SALVAGE_DEPTH + 5
    const rows = Array.from({ length: depth }, (_, i) =>
      row({ id: `r${i}`, partId: `p${i + 1}`, parentId: i === 0 ? null : `r${i - 1}` })
    )
    const nodes = buildSalvageTree({
      graph: chainGraph(depth + 1),
      rootPartId: 'p0',
      returnLineQuantity: 1,
      rows,
      parts: new Map(),
    })

    const flat = flattenSalvageTree(nodes)
    expect(flat).toHaveLength(MAX_SALVAGE_DEPTH)
    expect(Math.max(...flat.map((n) => n.depth))).toBe(MAX_SALVAGE_DEPTH - 1)
    const deepest = flat[flat.length - 1]
    expect(deepest?.children).toEqual([])
    expect(deepest?.hasChildren).toBe(false)
  })
})

// ============= Traversal helpers =============

describe('flattenSalvageTree and findSalvageNode', () => {
  const nodes = tree({
    graph: graphOf({ lift: [['mast', 1]], mast: [['bolt', 2]] }),
    rows: [row({ id: 'r1', partId: 'mast' })],
  })

  it('lists parents before children', () => {
    expect(flattenSalvageTree(nodes).map((n) => n.partId)).toEqual(['mast', 'bolt'])
  })

  it('finds a node by key at any depth', () => {
    expect(findSalvageNode(nodes, 'bom:r1:bolt')?.partId).toBe('bolt')
  })

  it('returns undefined for a key that is not in the tree', () => {
    expect(findSalvageNode(nodes, 'nope')).toBeUndefined()
  })

  it('is empty for an empty forest', () => {
    expect(flattenSalvageTree([])).toEqual([])
  })
})
