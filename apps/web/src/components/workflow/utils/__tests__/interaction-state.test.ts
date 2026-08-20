// apps/web/src/components/workflow/utils/__tests__/interaction-state.test.ts

import { describe, expect, it } from 'vitest'
import type { FlowEdge, FlowNode } from '../../types'
import { NodeType } from '../../types/node-types'
import {
  captureInteractionState,
  mergeInteractionState,
  storedGraphToCanvas,
} from '../interaction-state'

/**
 * The REHYDRATE seams — `plans/kopilot/workflow/23-graph-document-canonicalization.md`
 * §5, last trap, and the version popover two traps above it.
 *
 * Stripping canvas state at the write seam means the rehydrate path must
 * MERGE, not replace: authored content comes from the server, interaction
 * state stays local. Without that, an agent edit silently deselects whatever
 * the user had selected — and with the pre-strip document it did the opposite,
 * jumping the selection to a node the user was not looking at.
 */

const node = (id: string, over: Partial<FlowNode> = {}): FlowNode =>
  ({
    id,
    position: { x: 0, y: 0 },
    data: { id, type: NodeType.HTTP, title: id, desc: '' },
    ...over,
  }) as unknown as FlowNode

describe('captureInteractionState', () => {
  it('keys only the nodes that actually carry state', () => {
    const state = captureInteractionState([
      node('a', { selected: true }),
      node('b'),
      node('c', { dragging: true, measured: { width: 10, height: 20 } }),
    ])

    expect([...state.keys()].sort()).toEqual(['a', 'c'])
    expect(state.get('a')).toEqual({ selected: true })
    expect(state.get('c')).toEqual({ dragging: true, measured: { width: 10, height: 20 } })
  })

  it('never captures authored size — the server owns width/height', () => {
    const state = captureInteractionState([
      node('a', { selected: true, width: 400, height: 300 } as Partial<FlowNode>),
    ])
    expect(state.get('a')).toEqual({ selected: true })
  })
})

describe('mergeInteractionState — an external update must not clobber the selection', () => {
  it('carries the live selection forward onto the incoming document', () => {
    const live = [node('a', { selected: true }), node('b')]
    // What a stripped document looks like: no selection anywhere.
    const incoming = [
      node('a', { data: { id: 'a', type: NodeType.HTTP, title: 'renamed by agent' } as never }),
      node('b'),
    ]

    const merged = mergeInteractionState(incoming, live)

    expect(merged[0]?.selected).toBe(true)
    expect(merged[1]?.selected).toBeUndefined()
    // Authored content still comes from the server.
    expect(merged[0]?.data.title).toBe('renamed by agent')
  })

  it('lets the LIVE canvas win when the incoming document carries a stale selection', () => {
    const live = [node('a', { selected: true }), node('b', { selected: false })]
    // A pre-strip document: whatever `selected` happened to be persisted.
    const incoming = [node('a', { selected: false }), node('b', { selected: true })]

    const merged = mergeInteractionState(incoming, live)

    expect(merged.map((n) => n.selected)).toEqual([true, false])
  })

  it('carries dragging and measured, so an agent edit does not flicker the canvas', () => {
    const live = [node('a', { dragging: true, measured: { width: 240, height: 80 } })]
    const merged = mergeInteractionState([node('a')], live)

    expect(merged[0]?.dragging).toBe(true)
    expect(merged[0]?.measured).toEqual({ width: 240, height: 80 })
  })

  it('gives an agent-ADDED node no interaction state', () => {
    const live = [node('a', { selected: true })]
    const merged = mergeInteractionState([node('a'), node('new')], live)

    expect(merged[1]?.selected).toBeUndefined()
    expect(merged[1]?.dragging).toBeUndefined()
  })

  it('drops the state of a node the incoming document deleted', () => {
    const live = [node('a', { selected: true }), node('gone', { selected: true })]
    const merged = mergeInteractionState([node('a')], live)

    expect(merged).toHaveLength(1)
    expect(merged[0]?.id).toBe('a')
  })

  it('mutates neither input', () => {
    const live = [node('a', { selected: true })]
    const incoming = [node('a')]
    mergeInteractionState(incoming, live)

    expect(incoming[0]?.selected).toBeUndefined()
    expect(live[0]?.selected).toBe(true)
  })

  it('is a plain copy when the live canvas is empty — the INITIAL-LOAD shape', () => {
    const incoming = [node('a'), node('b')]
    const merged = mergeInteractionState(incoming, [])

    expect(merged).toEqual(incoming)
    expect(merged.every((n) => n.selected === undefined)).toBe(true)
  })
})

describe('storedGraphToCanvas — the version preview AND restore paths', () => {
  /**
   * What a stored `WorkflowVersion.graph` actually looks like: no `node.type`,
   * no `edge.data`, no handles, no `zIndex`. Raw into React Flow this renders
   * as the built-in default node — grey boxes, no handles, no panels.
   */
  const storedVersion = {
    nodes: [
      { id: 'n1', position: { x: 0, y: 0 }, data: { type: NodeType.MANUAL, title: 'Start' } },
      { id: 'n2', position: { x: 200, y: 0 }, data: { type: NodeType.HTTP, title: 'Call' } },
      { id: 'note', position: { x: 0, y: 200 }, data: { type: NodeType.NOTE, title: 'hi' } },
    ],
    edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
  }

  it('gives every node the React Flow component key it needs to render', () => {
    const { nodes } = storedGraphToCanvas(storedVersion, [])

    expect(nodes.map((n) => n.type)).toEqual(['standard', 'standard', 'note'])
  })

  it('rebuilds the edge metadata the canvas renders from', () => {
    const { edges } = storedGraphToCanvas(storedVersion, [])
    const edge = edges[0] as FlowEdge

    expect(edge.sourceHandle).toBe('source')
    expect(edge.targetHandle).toBe('target')
    expect(edge.zIndex).toBe(0)
    expect(edge.data?.sourceType).toBe(NodeType.MANUAL)
    expect(edge.data?.targetType).toBe(NodeType.HTTP)
  })

  it('rebuilds the canvas-only connection metadata', () => {
    const { nodes } = storedGraphToCanvas(storedVersion, [])

    expect(nodes[0]?.data._connectedSourceHandleIds).toEqual(['source'])
    expect(nodes[1]?.data._connectedTargetHandleIds).toEqual(['target'])
  })

  it('carries the live selection forward, so previewing does not deselect', () => {
    const { nodes } = storedGraphToCanvas(storedVersion, [node('n2', { selected: true })])

    expect(nodes.find((n) => n.id === 'n2')?.selected).toBe(true)
    expect(nodes.find((n) => n.id === 'n1')?.selected).toBeUndefined()
  })

  it('degrades rather than throwing on a malformed or empty graph', () => {
    expect(storedGraphToCanvas(null, [])).toEqual({ nodes: [], edges: [] })
    expect(storedGraphToCanvas({}, [])).toEqual({ nodes: [], edges: [] })
    expect(storedGraphToCanvas({ nodes: 'nope', edges: 7 }, [])).toEqual({ nodes: [], edges: [] })
  })
})
