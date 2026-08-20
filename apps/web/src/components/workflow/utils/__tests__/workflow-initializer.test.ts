// apps/web/src/components/workflow/utils/__tests__/workflow-initializer.test.ts

import { describe, expect, it } from 'vitest'
import type { FlowEdge, FlowNode } from '../../types'
import { NodeType } from '../../types/node-types'
import { initializeWorkflow } from '../workflow-initializer'

/**
 * `initializeWorkflow` is now a THIN WRAPPER over the shared hydrator
 * (`@auxx/lib/workflow-engine/client` `hydrateGraph`) plus the four
 * React-Flow-only `_`-keys — `plans/kopilot/workflow/23-graph-document-canonicalization.md`
 * §9. These tests pin the seam from web's side: everything the canvas used to
 * derive here must still come out, and the four extras must still be added.
 */

const nodesOf = (nodes: unknown[]) => nodes as unknown as FlowNode[]
const edgesOf = (edges: unknown[]) => edges as unknown as FlowEdge[]

const stored = () => ({
  nodes: nodesOf([
    { id: 'trigger', position: { x: 0, y: 0 }, data: { type: NodeType.MANUAL, title: 'Start' } },
    { id: 'loop', position: { x: 200, y: 0 }, data: { type: NodeType.LOOP, title: 'Loop' } },
    {
      id: 'child',
      parentId: 'loop',
      position: { x: 20, y: 40 },
      data: { type: NodeType.HTTP, title: 'Call' },
    },
    { id: 'note', position: { x: 0, y: 300 }, data: { type: NodeType.NOTE, title: 'note' } },
  ]),
  edges: edgesOf([
    { id: 'e-in', source: 'trigger', target: 'loop' },
    { id: 'e-back', source: 'child', target: 'loop', targetHandle: 'loop-back' },
  ]),
})

describe('initializeWorkflow — what the shared hydrator now derives', () => {
  it('sets the React Flow component key from data.type', () => {
    const { nodes } = initializeWorkflow(stored().nodes, stored().edges)
    expect(nodes.map((n) => n.type)).toEqual(['standard', 'standard', 'standard', 'note'])
  })

  it('pins a loop child to its container with extent: parent', () => {
    const { nodes } = initializeWorkflow(stored().nodes, stored().edges)
    const child = nodes.find((n) => n.id === 'child')

    // `initializeWorkflow` did NOT rebuild this before the hydrator — which is
    // why a loop child could be dragged out of its container after a reload.
    expect(child?.extent).toBe('parent')
    expect(nodes.find((n) => n.id === 'trigger')?.extent).toBeUndefined()
  })

  it('derives loop containment onto the child', () => {
    const { nodes } = initializeWorkflow(stored().nodes, stored().edges)
    const child = nodes.find((n) => n.id === 'child')

    expect(child?.data.isInLoop).toBe(true)
    expect(child?.data.loopId).toBe('loop')
  })

  it('derives edge endpoint types, handle defaults and zIndex', () => {
    const { edges } = initializeWorkflow(stored().nodes, stored().edges)
    const edge = edges.find((e) => e.id === 'e-in')

    expect(edge?.data?.sourceType).toBe(NodeType.MANUAL)
    expect(edge?.data?.targetType).toBe(NodeType.LOOP)
    expect(edge?.sourceHandle).toBe('source')
    expect(edge?.targetHandle).toBe('target')
    expect(edge?.zIndex).toBe(0)
  })

  it('flags the loop-back edge — server-side output resolution reads it', () => {
    const { edges } = initializeWorkflow(stored().nodes, stored().edges)

    expect(edges.find((e) => e.id === 'e-back')?.data?.isLoopBackEdge).toBe(true)
    expect(edges.find((e) => e.id === 'e-in')?.data?.isLoopBackEdge).toBeUndefined()
  })

  it('migrates a legacy app-trigger node type', () => {
    const { nodes } = initializeWorkflow(
      nodesOf([
        {
          id: 'n1',
          position: { x: 0, y: 0 },
          data: { type: 'app-trigger', appId: 'quickbooks', triggerId: 'invoice.created' },
        },
      ]),
      []
    )

    expect(nodes[0]?.data.type).toBe('quickbooks:invoice.created')
  })

  it('layers manifest defaults UNDER stored data — a default is a read, not a write', () => {
    const { nodes } = initializeWorkflow(
      nodesOf([
        { id: 'n1', position: { x: 0, y: 0 }, data: { type: NodeType.HTTP, title: 'Mine' } },
      ]),
      []
    )

    // Authored content always wins over the manifest blurb…
    expect(nodes[0]?.data.title).toBe('Mine')
    // …and unset config keys are filled from `manifest.defaultData()`, which is
    // what retires the panels' mount backfills (plan 23 §2.4).
    expect(Object.keys(nodes[0]?.data ?? {}).length).toBeGreaterThan(2)
  })
})

describe('initializeWorkflow — the React-Flow-only extras that stay in web', () => {
  it('rebuilds the connected-handle lists', () => {
    const { nodes } = initializeWorkflow(stored().nodes, stored().edges)

    expect(nodes.find((n) => n.id === 'trigger')?.data._connectedSourceHandleIds).toEqual([
      'source',
    ])
    expect(nodes.find((n) => n.id === 'loop')?.data._connectedTargetHandleIds).toEqual([
      'target',
      'loop-back',
    ])
  })

  it('rebuilds a loop container’s child list', () => {
    const { nodes } = initializeWorkflow(stored().nodes, stored().edges)
    const loop = nodes.find((n) => n.id === 'loop')

    expect((loop?.data as { _children?: unknown })._children).toEqual([
      { nodeId: 'child', nodeType: NodeType.HTTP },
    ])
  })

  it('rebuilds _targetBranches for a branching node', () => {
    const { nodes } = initializeWorkflow(
      nodesOf([
        {
          id: 'n1',
          position: { x: 0, y: 0 },
          data: { type: NodeType.IF_ELSE, title: 'If', cases: [{ case_id: 'true' }] },
        },
      ]),
      []
    )

    expect(nodes[0]?.data._targetBranches).toEqual([
      { id: 'true', name: 'IF', type: 'default' },
      { id: 'false', name: 'ELSE', type: 'default' },
    ])
  })

  it('does not mutate the stored graph it was handed', () => {
    const input = stored()
    initializeWorkflow(input.nodes, input.edges)

    expect(input.nodes[0]).not.toHaveProperty('type')
    expect(input.edges[0]).not.toHaveProperty('zIndex')
  })
})
