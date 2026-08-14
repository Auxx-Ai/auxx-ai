// packages/lib/src/workflows/graph-edit/layout.test.ts

import { describe, expect, it } from 'vitest'
import {
  calculateContainerSize,
  getLayoutByDagre,
  getLayoutForChildNodes,
  type LayoutEdge,
  type LayoutNode,
} from './layout'
import { CONTAINER_LAYOUT_CONFIG, LAYOUT_SPACING } from './layout-constants'

function node(id: string, extra: Partial<LayoutNode> = {}): LayoutNode {
  return { id, data: { type: 'wait' }, ...extra }
}

function edge(source: string, target: string): LayoutEdge {
  return { source, target }
}

describe('getLayoutByDagre', () => {
  it('lays a chain out left-to-right on one row', () => {
    const nodes = [node('trigger'), node('a'), node('b')]
    const edges = [edge('trigger', 'a'), edge('a', 'b')]

    const layout = getLayoutByDagre(nodes, edges)
    const trigger = layout.node('trigger')
    const a = layout.node('a')
    const b = layout.node('b')

    // Left to right: strictly increasing x…
    expect(trigger.x).toBeLessThan(a.x)
    expect(a.x).toBeLessThan(b.x)
    // …and a straight chain stays on one row.
    expect(a.y).toBe(trigger.y)
    expect(b.y).toBe(trigger.y)
  })

  it('stacks branch targets vertically in the same column', () => {
    const nodes = [node('if'), node('yes'), node('no')]
    const edges = [edge('if', 'yes'), edge('if', 'no')]

    const layout = getLayoutByDagre(nodes, edges)
    const yes = layout.node('yes')
    const no = layout.node('no')

    expect(yes.x).toBe(no.x)
    expect(yes.y).not.toBe(no.y)
  })

  it('does not move existing nodes when a downstream node is added', () => {
    const nodes = [node('trigger'), node('a'), node('b')]
    const edges = [edge('trigger', 'a'), edge('a', 'b')]

    const before = getLayoutByDagre(nodes, edges)
    const existing = ['trigger', 'a', 'b'].map((id) => ({ id, ...before.node(id) }))

    const after = getLayoutByDagre([...nodes, node('added')], [...edges, edge('b', 'added')])

    // §4: incremental add must leave every existing node's position identical.
    for (const prev of existing) {
      expect(after.node(prev.id).x).toBe(prev.x)
      expect(after.node(prev.id).y).toBe(prev.y)
    }
    expect(after.node('added').x).toBeGreaterThan(after.node('b').x)
  })

  it('excludes container children from the main layout so they are never repositioned by it', () => {
    const nodes = [node('loop'), node('child', { parentId: 'loop' })]
    const layout = getLayoutByDagre(nodes, [])

    expect(layout.node('loop')).toBeDefined()
    expect(layout.node('child')).toBeUndefined()
  })
})

describe('getLayoutForChildNodes', () => {
  it('positions loop children inside the container bounds', () => {
    const nodes = [node('loop'), node('c1', { parentId: 'loop' }), node('c2', { parentId: 'loop' })]
    const edges = [edge('c1', 'c2')]

    const layout = getLayoutForChildNodes('loop', nodes, edges)
    const size = calculateContainerSize('loop', nodes, layout)

    for (const id of ['c1', 'c2']) {
      const pos = layout.node(id)
      expect(pos).toBeDefined()
      // Child top-left corner respects the container margins…
      expect(pos.x - LAYOUT_SPACING.DEFAULT_NODE_WIDTH / 2).toBeGreaterThanOrEqual(
        CONTAINER_LAYOUT_CONFIG.marginx
      )
      expect(pos.y - LAYOUT_SPACING.DEFAULT_NODE_HEIGHT / 2).toBeGreaterThanOrEqual(0)
      // …and the child fits inside the computed container size.
      expect(pos.x + LAYOUT_SPACING.DEFAULT_NODE_WIDTH / 2).toBeLessThanOrEqual(size.width)
    }
    expect(layout.node('c1').x).toBeLessThan(layout.node('c2').x)
    // The main layout is untouched by children: the container itself is not in the child graph.
    expect(layout.node('loop')).toBeUndefined()
  })

  it('pins a loop-start child to the left edge, vertically centered on its successors', () => {
    const nodes = [
      node('loop'),
      node('start', { parentId: 'loop', data: { type: 'loop-start' } }),
      node('c1', { parentId: 'loop' }),
    ]
    const edges = [edge('start', 'c1')]

    const layout = getLayoutForChildNodes('loop', nodes, edges)
    const start = layout.node('start')
    const c1 = layout.node('c1')

    expect(start).toBeDefined()
    expect(start.x).toBeLessThan(c1.x)
    expect(start.y).toBe(c1.y)
  })
})

describe('calculateContainerSize', () => {
  it('falls back to the default node size when the container is empty', () => {
    const layout = getLayoutByDagre([], [])
    expect(calculateContainerSize('loop', [node('loop')], layout)).toEqual({
      width: LAYOUT_SPACING.DEFAULT_NODE_WIDTH,
      height: LAYOUT_SPACING.DEFAULT_NODE_HEIGHT,
    })
  })
})
