// apps/web/src/components/workflow/hooks/__tests__/use-workflow-shortcuts.collapse.test.ts
//
// The workflow detail page mounts `EntityNavButtons` in its breadcrumb, which
// binds `J`/`K` to walk the workflow switcher's list. Collapse therefore had to
// vacate bare `K` — and because `useHotkey` is registered with
// `conflictBehavior: 'allow'`, a regression here would not throw: both handlers
// would fire, collapsing a node AND navigating away from it.

import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  /** Every key `useWorkflowShortcuts` registered, in order. */
  registered: [] as Array<{ keys: string; handler: () => void }>,
  toggleCollapse: vi.fn(),
  /** Any selector over the canvas stores gets a no-op — only the keymap is under test. */
  selectorStore: (selector: (state: unknown) => unknown) =>
    selector(new Proxy({}, { get: () => vi.fn() })),
}))

vi.mock('@tanstack/react-hotkeys', () => ({
  useHotkey: (keys: string, handler: () => void) => {
    h.registered.push({ keys, handler })
  },
}))

vi.mock('@xyflow/react', () => ({
  useReactFlow: () => ({ fitView: vi.fn(), zoomIn: vi.fn(), zoomOut: vi.fn() }),
  useStoreApi: () => ({ getState: () => ({ nodes: [], edges: [] }) }),
}))

vi.mock('../../store/canvas-store', () => ({ useCanvasStore: h.selectorStore }))
vi.mock('../../store/interaction-store', () => ({ useInteractionStore: h.selectorStore }))
vi.mock('../../store/panel-store', () => ({ usePanelStore: h.selectorStore }))
vi.mock('../../store/workflow-store-provider', () => ({ useHistoryManager: () => ({}) }))
vi.mock('../use-read-only', () => ({ useNodesReadOnly: () => ({ getNodesReadOnly: () => false }) }))
vi.mock('../use-workflow-save', () => ({ useWorkflowSave: () => ({ save: vi.fn() }) }))
vi.mock('../use-workflow-organize', () => ({
  useWorkflowOrganize: () => ({ handleLayout: vi.fn(), canOrganize: true }),
}))
vi.mock('../use-edge-interactions', () => ({
  useEdgeInteractions: () => ({ handleBulkEdgeDelete: vi.fn() }),
}))
vi.mock('../use-node-interactions', () => ({
  useNodesInteractions: () => ({
    handleCopyNode: vi.fn(),
    handleNodesPaste: vi.fn(),
    handleDeleteNode: vi.fn(),
    handleSelectAll: vi.fn(),
    handleNodeDisable: vi.fn(),
    handleToggleCollapse: h.toggleCollapse,
  }),
}))

import { useWorkflowShortcuts } from '../use-workflow-shortcuts'

describe('useWorkflowShortcuts — collapse binding', () => {
  beforeEach(() => {
    h.registered.length = 0
    h.toggleCollapse.mockClear()
    renderHook(() => useWorkflowShortcuts())
  })

  it('binds collapse to Shift+K', () => {
    const binding = h.registered.find((r) => r.keys === 'Shift+K')

    expect(binding).toBeDefined()
    binding?.handler()
    expect(h.toggleCollapse).toHaveBeenCalled()
  })

  it('leaves bare J and K to the breadcrumb list nav', () => {
    expect(h.registered.map((r) => r.keys)).not.toContain('K')
    expect(h.registered.map((r) => r.keys)).not.toContain('J')
  })
})
