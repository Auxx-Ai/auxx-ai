// packages/lib/src/returns/__tests__/salvage-invariants.test.ts

/**
 * `returns/salvage-invariants.ts` - plan section 6.6's three rules.
 *
 * **No doubles.** The trees under test are built by the real
 * `buildSalvageTree` from real BOM maps and real row arrays, so a change that
 * breaks the builder's contract breaks these too, which is the point.
 *
 * The traps each get their own case: a `good` node nested under a `good` one,
 * a split that invents a unit, sixteen bolts legitimately under four masts
 * (the reading of invariant 2 that would refuse every real tree), a standard
 * cost of exactly zero, and an uncosted part that is shadowed and therefore
 * never salvaged at all.
 */

import { describe, expect, it } from 'vitest'
import {
  checkNoNestedGoodNodes,
  checkSalvageQuantityBounds,
  checkSalvageStandardCosts,
  checkSalvageTree,
  findMissingStandardCosts,
  findQuantityAllowanceBreaches,
  findShadowedGoodNodes,
  selectSalvageMovementNodes,
} from '../salvage-invariants'
import { buildSalvageTree } from '../salvage-tree'
import {
  DEFAULT_SALVAGE_PERCENT,
  type MaterializedSalvageRow,
  ROOT_SALVAGE_KEY,
  type SalvageNode,
  type SalvageStatus,
  type SubpartGraph,
} from '../types'

function graphOf(edges: Record<string, [string, number][]>): SubpartGraph {
  return new Map(
    Object.entries(edges).map(([parent, children]) => [
      parent,
      children.map(([childId, qty]) => ({ childId, qty })),
    ])
  )
}

function row(
  id: string,
  partId: string,
  over: Partial<MaterializedSalvageRow> = {}
): MaterializedSalvageRow {
  return {
    id,
    partId,
    parentId: null,
    quantity: 1,
    status: 'undecided' as SalvageStatus,
    salvagePercent: DEFAULT_SALVAGE_PERCENT,
    ...over,
  }
}

function build(
  graph: SubpartGraph,
  rows: MaterializedSalvageRow[],
  returnLineQuantity = 1
): SalvageNode[] {
  return buildSalvageTree({
    graph,
    rootPartId: 'lift',
    returnLineQuantity,
    rows,
    parts: new Map([
      ['mast', { name: 'Mast', number: 'P-1' }],
      ['cylinder', { name: 'Cylinder', number: 'P-2' }],
      ['bolt', { name: 'Bolt', number: 'P-3' }],
    ]),
  })
}

/** lift -> 1 mast -> 2 cylinders -> 4 bolts. */
const DEEP = graphOf({
  lift: [['mast', 1]],
  mast: [['cylinder', 2]],
  cylinder: [['bolt', 4]],
})

// ============= Invariant 1: one recovery per branch =============

describe('selectSalvageMovementNodes', () => {
  it('selects nothing when nothing is good', () => {
    const roots = build(DEEP, [row('r1', 'mast', { status: 'damaged' })])
    expect(selectSalvageMovementNodes(roots)).toEqual([])
  })

  it('selects a good top-level node', () => {
    const roots = build(DEEP, [row('r1', 'mast', { status: 'good' })])
    expect(selectSalvageMovementNodes(roots).map((n) => n.key)).toEqual(['r1'])
  })

  it('selects the HIGHEST good node and not its good children', () => {
    const roots = build(DEEP, [
      row('r1', 'mast', { status: 'good' }),
      row('r2', 'cylinder', { parentId: 'r1', status: 'good', quantity: 2 }),
    ])
    expect(selectSalvageMovementNodes(roots).map((n) => n.key)).toEqual(['r1'])
  })

  it('stops at the first good node even when a lower one is also good', () => {
    // good -> damaged -> good: only the top one recovers, its whole subtree
    // came back into inventory with it.
    const roots = build(DEEP, [
      row('r1', 'mast', { status: 'good' }),
      row('r2', 'cylinder', { parentId: 'r1', status: 'damaged', quantity: 2 }),
      row('r3', 'bolt', { parentId: 'r2', status: 'good', quantity: 8 }),
    ])
    expect(selectSalvageMovementNodes(roots).map((n) => n.key)).toEqual(['r1'])
  })

  it('descends through a damaged parent to a good child', () => {
    const roots = build(DEEP, [
      row('r1', 'mast', { status: 'damaged' }),
      row('r2', 'cylinder', { parentId: 'r1', status: 'good', quantity: 2 }),
    ])
    expect(selectSalvageMovementNodes(roots).map((n) => n.key)).toEqual(['r2'])
  })

  it('selects every good sibling', () => {
    const graph = graphOf({
      lift: [
        ['mast', 1],
        ['cylinder', 1],
      ],
    })
    const roots = build(graph, [
      row('r1', 'mast', { status: 'good' }),
      row('r2', 'cylinder', { status: 'good' }),
    ])
    expect(selectSalvageMovementNodes(roots).map((n) => n.key)).toEqual(['r1', 'r2'])
  })

  it('treats an unexpanded node as a leaf', () => {
    // The cylinder under the damaged mast has no row, so there is nothing
    // beneath it to recover.
    const roots = build(DEEP, [row('r1', 'mast', { status: 'damaged' })])
    expect(roots[0]?.children?.[0]?.children).toBeNull()
    expect(selectSalvageMovementNodes(roots)).toEqual([])
  })
})

describe('findShadowedGoodNodes', () => {
  it('finds nothing in a tree with no nesting', () => {
    const roots = build(DEEP, [
      row('r1', 'mast', { status: 'good' }),
      row('r2', 'cylinder', { parentId: 'r1', status: 'damaged', quantity: 2 }),
    ])
    expect(findShadowedGoodNodes(roots)).toEqual([])
    expect(checkNoNestedGoodNodes(roots).isOk()).toBe(true)
  })

  it('pairs a nested good node with the good ancestor that shadows it', () => {
    const roots = build(DEEP, [
      row('r1', 'mast', { status: 'good' }),
      row('r2', 'cylinder', { parentId: 'r1', status: 'good', quantity: 2 }),
    ])
    const shadowed = findShadowedGoodNodes(roots)
    expect(shadowed).toHaveLength(1)
    expect(shadowed[0]?.node.key).toBe('r2')
    expect(shadowed[0]?.ancestor.key).toBe('r1')
  })

  it('reports the highest good ancestor for every level of a triple nesting', () => {
    const roots = build(DEEP, [
      row('r1', 'mast', { status: 'good' }),
      row('r2', 'cylinder', { parentId: 'r1', status: 'good', quantity: 2 }),
      row('r3', 'bolt', { parentId: 'r2', status: 'good', quantity: 8 }),
    ])
    const shadowed = findShadowedGoodNodes(roots)
    expect(shadowed.map((s) => [s.node.key, s.ancestor.key])).toEqual([
      ['r2', 'r1'],
      ['r3', 'r1'],
    ])
  })

  it('refuses, naming the part, when asked to', () => {
    const roots = build(DEEP, [
      row('r1', 'mast', { status: 'good' }),
      row('r2', 'cylinder', { parentId: 'r1', status: 'good', quantity: 2 }),
    ])
    const result = checkNoNestedGoodNodes(roots)
    expect(result.isErr()).toBe(true)
    if (result.isErr()) {
      expect(result.error.reason).toBe('nested_good_node')
      expect(result.error.partName).toBe('Cylinder')
      expect(result.error.statusCode).toBe(422)
      expect(result.error.message).toContain('Cylinder')
    }
  })
})

// ============= Invariant 2: a parent's quantity bounds its children =============

describe('findQuantityAllowanceBreaches', () => {
  const bounds = (roots: SalvageNode[], graph: SubpartGraph, returnLineQuantity = 1) => ({
    roots,
    graph,
    rootPartId: 'lift',
    returnLineQuantity,
  })

  it('accepts the ordinary tree, where children far outnumber their parent', () => {
    // 4 masts, each holding 4 bolts, is 16 bolts under a parent of 4. A naive
    // "sum(children) <= parent.quantity" reading would refuse this, and it
    // would refuse every real BOM.
    const graph = graphOf({ lift: [['mast', 4]], mast: [['bolt', 4]] })
    const roots = build(graph, [row('r1', 'mast', { quantity: 4 })])
    expect(roots[0]?.children?.[0]?.quantity).toBe(16)
    expect(findQuantityAllowanceBreaches(bounds(roots, graph))).toEqual([])
  })

  it('accepts a split that adds up to exactly the allowance', () => {
    const graph = graphOf({ lift: [['mast', 4]] })
    const roots = build(graph, [
      row('r1', 'mast', { quantity: 3, status: 'good', sortOrder: 'a' }),
      row('r2', 'mast', { quantity: 1, status: 'scrap', sortOrder: 'b' }),
    ])
    expect(findQuantityAllowanceBreaches(bounds(roots, graph))).toEqual([])
  })

  it('refuses a split that invents a unit', () => {
    const graph = graphOf({ lift: [['mast', 4]] })
    const roots = build(graph, [
      row('r1', 'mast', { quantity: 3, sortOrder: 'a' }),
      row('r2', 'mast', { quantity: 2, sortOrder: 'b' }),
    ])
    const breaches = findQuantityAllowanceBreaches(bounds(roots, graph))
    expect(breaches).toHaveLength(1)
    expect(breaches[0]).toMatchObject({
      reason: 'quantity_exceeds_allowance',
      parentKey: ROOT_SALVAGE_KEY,
      partId: 'mast',
      partName: 'Mast',
      allowed: 4,
      total: 5,
    })
  })

  it('scales the top-level allowance by the return line quantity', () => {
    const graph = graphOf({ lift: [['mast', 2]] })
    // Two lifts back, so 4 masts are allowed and 5 are not.
    const four = build(graph, [row('r1', 'mast', { quantity: 4 })], 2)
    expect(findQuantityAllowanceBreaches(bounds(four, graph, 2))).toEqual([])
    const five = build(graph, [row('r1', 'mast', { quantity: 5 })], 2)
    expect(findQuantityAllowanceBreaches(bounds(five, graph, 2))).toHaveLength(1)
  })

  it('bounds a split deeper in the tree against its own parent', () => {
    const graph = graphOf({ lift: [['mast', 1]], mast: [['cylinder', 2]] })
    const roots = build(graph, [
      row('r1', 'mast', { quantity: 1 }),
      row('r2', 'cylinder', { parentId: 'r1', quantity: 2, sortOrder: 'a' }),
      row('r3', 'cylinder', { parentId: 'r1', quantity: 1, sortOrder: 'b' }),
    ])
    const breaches = findQuantityAllowanceBreaches(bounds(roots, graph))
    expect(breaches).toHaveLength(1)
    expect(breaches[0]).toMatchObject({ parentKey: 'r1', allowed: 2, total: 3 })
  })

  it('skips a part with no BOM edge under its parent rather than refusing it', () => {
    // The BOM was edited after the row was written: there is no allowance to
    // compare against, and inventing one would refuse a recorded decision.
    const graph = graphOf({ lift: [['mast', 1]] })
    const roots = build(graph, [row('r9', 'retired', { quantity: 99 })])
    expect(findQuantityAllowanceBreaches(bounds(roots, graph))).toEqual([])
  })

  it('reports every breach but refuses on the first', () => {
    const graph = graphOf({
      lift: [
        ['mast', 1],
        ['cylinder', 1],
      ],
    })
    const roots = build(graph, [
      row('r1', 'mast', { quantity: 2 }),
      row('r2', 'cylinder', { quantity: 3 }),
    ])
    expect(findQuantityAllowanceBreaches(bounds(roots, graph))).toHaveLength(2)
    const result = checkSalvageQuantityBounds(bounds(roots, graph))
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.partId).toBe('mast')
  })

  it('accepts an empty tree', () => {
    expect(findQuantityAllowanceBreaches(bounds([], new Map()))).toEqual([])
  })
})

// ============= Invariant 3: a salvaged part must be costed =============

describe('findMissingStandardCosts', () => {
  const costs = (entries: [string, number | null | undefined][]) =>
    new Map<string, number | null | undefined>(entries)

  it('accepts a costed good node', () => {
    const roots = build(DEEP, [row('r1', 'mast', { status: 'good' })])
    expect(findMissingStandardCosts({ roots, standardCosts: costs([['mast', 12345]]) })).toEqual([])
  })

  it('refuses a good node whose part has no cost at all, naming the part', () => {
    const roots = build(DEEP, [row('r1', 'mast', { status: 'good' })])
    const missing = findMissingStandardCosts({ roots, standardCosts: new Map() })
    expect(missing).toHaveLength(1)
    expect(missing[0]).toMatchObject({
      reason: 'missing_standard_cost',
      partId: 'mast',
      partName: 'Mast',
      standardCost: null,
    })
    expect(missing[0]?.message).toContain('Mast')
  })

  it('refuses a standard cost of exactly zero', () => {
    // The trap: a zero passes every guard that tests `== null`, and freezes
    // $0 onto an append-only ledger.
    const roots = build(DEEP, [row('r1', 'mast', { status: 'good' })])
    const missing = findMissingStandardCosts({ roots, standardCosts: costs([['mast', 0]]) })
    expect(missing).toHaveLength(1)
    expect(missing[0]?.standardCost).toBe(0)
  })

  it('refuses an explicit null and a negative cost', () => {
    const roots = build(DEEP, [row('r1', 'mast', { status: 'good' })])
    expect(
      findMissingStandardCosts({ roots, standardCosts: costs([['mast', null]]) })
    ).toHaveLength(1)
    expect(findMissingStandardCosts({ roots, standardCosts: costs([['mast', -5]]) })).toHaveLength(
      1
    )
  })

  it('ignores an uncosted part that is not good', () => {
    const roots = build(DEEP, [row('r1', 'mast', { status: 'damaged' })])
    expect(findMissingStandardCosts({ roots, standardCosts: new Map() })).toEqual([])
  })

  it('ignores an uncosted good node that is shadowed by a good ancestor', () => {
    // It produces no movement, so its cost is nobody's problem.
    const roots = build(DEEP, [
      row('r1', 'mast', { status: 'good' }),
      row('r2', 'cylinder', { parentId: 'r1', status: 'good', quantity: 2 }),
    ])
    const missing = findMissingStandardCosts({ roots, standardCosts: costs([['mast', 900]]) })
    expect(missing).toEqual([])
  })

  it('reports one error per part, not one per row', () => {
    const graph = graphOf({ lift: [['mast', 4]] })
    const roots = build(graph, [
      row('r1', 'mast', { quantity: 2, status: 'good', sortOrder: 'a' }),
      row('r2', 'mast', { quantity: 2, status: 'good', sortOrder: 'b' }),
    ])
    expect(findMissingStandardCosts({ roots, standardCosts: new Map() })).toHaveLength(1)
  })

  it('refuses through checkSalvageStandardCosts with a 422', () => {
    const roots = build(DEEP, [row('r1', 'mast', { status: 'good' })])
    const result = checkSalvageStandardCosts({ roots, standardCosts: new Map() })
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.statusCode).toBe(422)
  })
})

// ============= All three together =============

describe('checkSalvageTree', () => {
  const graph = graphOf({ lift: [['mast', 4]], mast: [['cylinder', 2]] })

  it('returns the nodes that would move stock', () => {
    const roots = build(graph, [
      row('r1', 'mast', { quantity: 3, status: 'good', sortOrder: 'a' }),
      row('r2', 'mast', { quantity: 1, status: 'scrap', sortOrder: 'b' }),
    ])
    const result = checkSalvageTree({
      roots,
      graph,
      rootPartId: 'lift',
      returnLineQuantity: 1,
      standardCosts: new Map([['mast', 5000]]),
    })
    expect(result.isOk()).toBe(true)
    if (result.isOk()) expect(result.value.map((n) => n.key)).toEqual(['r1'])
  })

  it('refuses on the quantity bound before it looks at costs', () => {
    const roots = build(graph, [
      row('r1', 'mast', { quantity: 3, status: 'good', sortOrder: 'a' }),
      row('r2', 'mast', { quantity: 3, status: 'good', sortOrder: 'b' }),
    ])
    const result = checkSalvageTree({
      roots,
      graph,
      rootPartId: 'lift',
      returnLineQuantity: 1,
      standardCosts: new Map(),
    })
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.reason).toBe('quantity_exceeds_allowance')
  })

  it('selects past a nested good node by default, and refuses when asked', () => {
    const roots = build(graph, [
      row('r1', 'mast', { quantity: 4, status: 'good' }),
      row('r2', 'cylinder', { parentId: 'r1', quantity: 8, status: 'good' }),
    ])
    const base = {
      roots,
      graph,
      rootPartId: 'lift',
      returnLineQuantity: 1,
      standardCosts: new Map([['mast', 5000]]),
    }
    const lenient = checkSalvageTree(base)
    expect(lenient.isOk()).toBe(true)
    if (lenient.isOk()) expect(lenient.value.map((n) => n.key)).toEqual(['r1'])

    const strict = checkSalvageTree({ ...base, refuseNestedGood: true })
    expect(strict.isErr()).toBe(true)
    if (strict.isErr()) expect(strict.error.reason).toBe('nested_good_node')
  })

  it('accepts a tree where nothing is good and therefore nothing moves', () => {
    const roots = build(graph, [row('r1', 'mast', { quantity: 4, status: 'missing' })])
    const result = checkSalvageTree({
      roots,
      graph,
      rootPartId: 'lift',
      returnLineQuantity: 1,
      standardCosts: new Map(),
    })
    expect(result.isOk()).toBe(true)
    if (result.isOk()) expect(result.value).toEqual([])
  })
})
