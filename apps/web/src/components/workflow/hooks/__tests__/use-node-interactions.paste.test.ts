// apps/web/src/components/workflow/hooks/__tests__/use-node-interactions.paste.test.ts
//
// Paste/duplicate builds `idMapping[oldNodeId] = newNodeId` and applies it to
// node ids and edges, but historically never walked `node.data` — a pasted
// node's `{{oldNodeId.…}}` refs (and bare variable-id attrs) kept pointing at
// the ORIGINAL nodes' outputs. Fixed by rewriting each pasted node's `data`
// with `rewriteVariableRefs` (`@auxx/lib/workflows/variable-ref-rewriter`)
// after a deep clone. This suite proves: a ref between two pasted nodes gets
// remapped to the new id regardless of clipboard iteration order, a ref to a
// node OUTSIDE the paste set is left untouched, and the original nodes' data
// is never mutated by the paste.

import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FlowEdge, FlowNode } from '~/components/workflow/types'

const h = vi.hoisted(() => ({
  /** The xyflow store's `nodes`/`edges`, and the setters under test. */
  nodes: [] as FlowNode[],
  edges: [] as FlowEdge[],
  setNodes: vi.fn(),
  setEdges: vi.fn(),
  /** Clipboard, as populated by a prior `handleCopyNode` (direct references, not clones). */
  clipboardElements: [] as FlowNode[],
  /** Sequential, inspectable replacement for `generateId()`. */
  generateId: vi.fn(),
}))

vi.mock('@xyflow/react', () => ({
  getConnectedEdges: vi.fn(() => []),
  useReactFlow: () => ({ screenToFlowPosition: (p: unknown) => p }),
  useStoreApi: () => ({
    getState: () => ({
      nodes: h.nodes,
      setNodes: h.setNodes,
      edges: h.edges,
      setEdges: h.setEdges,
    }),
  }),
}))

vi.mock('@auxx/ui/components/toast', () => ({
  toastError: vi.fn(),
  toastInfo: vi.fn(),
  toastSuccess: vi.fn(),
}))

vi.mock('@auxx/utils', () => ({ uniqueBy: (arr: unknown[]) => arr }))
vi.mock('@auxx/utils/generateId', () => ({ generateId: h.generateId }))

vi.mock('~/components/workflow/hooks', () => ({
  useHelpline: () => ({ handleSetHelpline: vi.fn(), handleClearHelpline: vi.fn() }),
  useNodesReadOnly: () => ({ getNodesReadOnly: () => false }),
  useNodeValidation: () => ({ isValidConnection: vi.fn() }),
  useSelectionActions: () => ({ selectNode: vi.fn() }),
  useWorkflowSave: () => ({ debouncedSave: vi.fn() }),
}))

vi.mock('~/components/workflow/nodes/unified-registry', () => ({
  ALLOW_TRIGGER_DELETE: true,
  unifiedNodeRegistry: { isTrigger: () => false },
}))

vi.mock('~/components/workflow/store/event-bus', () => ({
  storeEventBus: { emit: vi.fn() },
}))

vi.mock('~/components/workflow/store/panel-store', () => ({
  usePanelStore: (selector: (state: unknown) => unknown) =>
    selector({ closePanel: vi.fn(), isPinned: false }),
}))

vi.mock('~/components/workflow/store/workflow-store', () => ({
  useWorkflowStore: {
    getState: () => ({
      clipboardElements: h.clipboardElements,
      setClipboardElements: vi.fn(),
      setDragging: vi.fn(),
    }),
  },
}))

vi.mock('~/components/workflow/utils', () => ({
  getNodesConnectedSourceOrTargetHandleIdsMap: vi.fn(),
}))
vi.mock('~/components/workflow/utils/edge-utils', () => ({ calculateZIndex: vi.fn(() => 0) }))
vi.mock('~/components/workflow/utils/layout-constants', () => ({
  LAYOUT_SPACING: { NODE_HORIZONTAL_PADDING: 0, NODE_VERTICAL_PADDING: 0 },
}))
vi.mock('~/components/workflow/utils/node-layout', () => ({ NodeFactory: { createNode: vi.fn() } }))
// Identity — this suite isn't about title de-duplication.
vi.mock('~/components/workflow/utils/unique-title-generator', () => ({
  generateUniqueTitle: (title: string) => title,
}))
vi.mock('~/components/workflow/utils/viewport-utils', () => ({ centerOnNode: vi.fn() }))

vi.mock('../use-save-to-history', () => ({
  useWorkflowHistory: () => ({ saveStateToHistory: vi.fn() }),
  WorkflowHistoryEvent: { NodePaste: 'NodePaste' },
}))

import { useNodesInteractions } from '../use-node-interactions'

/** Builds a minimal FlowNode fixture. `data` carries the fields this suite exercises. */
function buildNode(id: string, data: Record<string, unknown>, position = { x: 0, y: 0 }): FlowNode {
  return {
    id,
    position,
    selected: true,
    data: { id, type: 'action', title: `Node ${id}`, ...data },
  } as unknown as FlowNode
}

describe('useNodesInteractions — paste rewrites variable references', () => {
  beforeEach(() => {
    h.setNodes.mockClear()
    h.setEdges.mockClear()
    let counter = 0
    h.generateId.mockReset().mockImplementation((prefix?: string) => {
      counter += 1
      return prefix ? `${prefix}-${counter}` : `new-${counter}`
    })
  })

  it('remaps a ref between two pasted nodes, leaves a ref to an unselected node untouched, and never mutates the originals', () => {
    // Canvas: nodeA -> nodeB (both about to be pasted), plus nodeC, which
    // stays put and is NOT part of the paste set.
    const nodeA = buildNode('a1', {
      config: { note: 'unrelated ref: {{c1.value}}' },
    })
    const nodeB = buildNode('b1', {
      config: {
        message: 'Value: {{a1.output}}',
        // Bare (non-`{{…}}`) variable-id reference, the shape a Tiptap
        // `variable-node`'s `attrs.variableId` stores.
        bareVar: 'a1.output[0].x',
      },
    })
    const nodeC = buildNode('c1', { config: { note: 'stays on canvas' } })

    // Snapshot the exact objects the paste must not touch.
    const originalNodeAConfig = { ...((nodeA.data as { config: unknown }).config as object) }
    const originalNodeBConfig = { ...((nodeB.data as { config: unknown }).config as object) }

    h.nodes = [nodeA, nodeB, nodeC]
    h.edges = [
      {
        id: 'e-a1-b1',
        source: 'a1',
        target: 'b1',
        sourceHandle: 'source',
        targetHandle: 'target',
        data: {},
      } as unknown as FlowEdge,
    ]
    // Clipboard holds direct references to the copied nodes (as the real
    // `handleCopyNode` stores them) — reversed order from canvas, so a naive
    // single-pass id assignment (old bug shape) would fail to resolve nodeB's
    // ref to nodeA in time.
    h.clipboardElements = [nodeB, nodeA]

    const { result } = renderHook(() => useNodesInteractions())
    result.current.handleNodesPaste()

    expect(h.setNodes).toHaveBeenCalledOnce()
    const nextNodes = h.setNodes.mock.calls[0]![0] as FlowNode[]
    const pastedNodes = nextNodes.filter((n) => n.id !== 'a1' && n.id !== 'b1' && n.id !== 'c1')
    expect(pastedNodes).toHaveLength(2)

    const pastedA = pastedNodes.find((n) => (n.data as { config: any }).config.note)!
    const pastedB = pastedNodes.find((n) => (n.data as { config: any }).config.message)!
    expect(pastedA).toBeDefined()
    expect(pastedB).toBeDefined()

    const newIdA = pastedA.id
    const newIdB = pastedB.id
    expect(newIdA).not.toBe('a1')
    expect(newIdB).not.toBe('b1')

    // The ref to the OTHER pasted node is remapped to its new id.
    expect((pastedB.data as { config: any }).config.message).toBe(`Value: {{${newIdA}.output}}`)
    // Bare (non-`{{…}}`) variable-id refs are rewritten the same way.
    expect((pastedB.data as { config: any }).config.bareVar).toBe(`${newIdA}.output[0].x`)
    // The ref to c1 — NOT in the paste set — survives untouched.
    expect((pastedA.data as { config: any }).config.note).toBe('unrelated ref: {{c1.value}}')

    // The pasted edge follows the same id remapping.
    expect(h.setEdges).toHaveBeenCalledOnce()
    const nextEdges = h.setEdges.mock.calls[0]![0] as FlowEdge[]
    const pastedEdge = nextEdges.find((e) => e.id !== 'e-a1-b1')!
    expect(pastedEdge).toBeDefined()
    expect(pastedEdge.source).toBe(newIdA)
    expect(pastedEdge.target).toBe(newIdB)

    // The originals are byte-for-byte unmutated — paste must not corrupt them.
    expect((nodeA.data as { config: unknown }).config).toEqual(originalNodeAConfig)
    expect((nodeB.data as { config: unknown }).config).toEqual(originalNodeBConfig)
  })
})
