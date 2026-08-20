// apps/web/src/components/workflow/hooks/__tests__/workflow-history-restore-dirty.test.tsx
//
// History restores (undo/redo) bypass the canvas interaction paths that mark
// the workflow store dirty, so the restore wrapper registered by
// `WorkflowHistoryProvider` must mark dirty itself. Load-bearing for the
// Kopilot flow (4b): a Kopilot edit rehydrates a CLEAN canvas and records a
// history entry; Cmd+Z on that entry must leave the canvas DIRTY, or the
// undone state is unsaveable (autosave, Mod+S's dirty check, and the
// beforeunload beacon all skip a clean canvas).

import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HistoryManager } from '../../store/history-manager'

const h = vi.hoisted(() => ({
  manager: null as unknown,
  markDirty: vi.fn(),
  rfSetNodes: vi.fn(),
  rfSetEdges: vi.fn(),
  liveNodes: [] as any[],
}))

vi.mock('@xyflow/react', () => ({
  useStoreApi: () => ({
    getState: () => ({
      setNodes: h.rfSetNodes,
      setEdges: h.rfSetEdges,
      nodes: h.liveNodes,
      edges: [],
    }),
  }),
}))

vi.mock('../use-save-to-history', () => ({
  useWorkflowHistory: () => ({
    onUndo: () => () => {},
    onRedo: () => () => {},
    saveInitialState: vi.fn(),
  }),
}))

vi.mock('../../store/workflow-store', () => ({
  useWorkflowStore: { getState: () => ({ markDirty: h.markDirty }) },
}))

vi.mock('../../store/workflow-store-provider', () => ({
  useHistoryManager: () => h.manager,
}))

import { WorkflowHistoryProvider } from '../../store/workflow-history-provider'

function entry(tag: string) {
  return {
    action: 'workflow_event',
    store: 'workflow',
    data: {
      event: 'NodeChange',
      nodes: [{ id: tag, position: { x: 0, y: 0 }, data: { title: tag } }],
      edges: [],
    },
    label: tag,
  }
}

describe('WorkflowHistoryProvider — restores mark the canvas dirty', () => {
  let manager: HistoryManager

  beforeEach(() => {
    manager = new HistoryManager()
    h.manager = manager
    h.markDirty.mockClear()
    h.rfSetNodes.mockClear()
    h.rfSetEdges.mockClear()
    h.liveNodes = []
    render(<WorkflowHistoryProvider>{null}</WorkflowHistoryProvider>)
  })

  it('undo restores the previous snapshot AND marks dirty', () => {
    manager.record(entry('before-kopilot'))
    manager.record(entry('kopilot-edit'))
    expect(h.markDirty).not.toHaveBeenCalled()

    manager.undo()

    // The previous (pre-Kopilot) snapshot is what lands on the canvas…
    expect(h.rfSetNodes).toHaveBeenCalledTimes(1)
    expect(h.rfSetNodes.mock.calls[0][0][0].id).toBe('before-kopilot')
    // …and the canvas is dirty, so the undone state is saveable.
    expect(h.markDirty).toHaveBeenCalled()
  })

  it('redo marks dirty too', () => {
    manager.record(entry('before-kopilot'))
    manager.record(entry('kopilot-edit'))
    manager.undo()
    h.markDirty.mockClear()

    manager.redo()

    expect(h.rfSetNodes.mock.calls.at(-1)?.[0][0].id).toBe('kopilot-edit')
    expect(h.markDirty).toHaveBeenCalled()
  })

  it('an undo with nothing to restore does not mark dirty', () => {
    manager.record(entry('only'))
    manager.undo() // needs ≥2 states — no-op
    expect(h.rfSetNodes).not.toHaveBeenCalled()
    expect(h.markDirty).not.toHaveBeenCalled()
  })
})

// A history snapshot is authored content. Interaction state — selection, drag
// flag, React Flow's measured box — belongs to the canvas the user is looking
// at, and the restore seam has to carry it across rather than replay whatever
// the snapshot happened to store. This was the last wholesale `setNodes` in the
// builder that skipped `mergeInteractionState`.
describe('WorkflowHistoryProvider — restores preserve interaction state', () => {
  let manager: HistoryManager

  beforeEach(() => {
    manager = new HistoryManager()
    h.manager = manager
    h.rfSetNodes.mockClear()
    h.liveNodes = [{ id: 'n1', selected: true, measured: { width: 200, height: 80 } }]
    render(<WorkflowHistoryProvider>{null}</WorkflowHistoryProvider>)
  })

  function snapshot(tag: string) {
    return {
      action: 'workflow_event',
      store: 'workflow',
      // No `selected`, no `measured` — exactly what the snapshot whitelist stores.
      data: { event: 'NodeChange', nodes: [{ id: 'n1', data: { title: tag } }], edges: [] },
      label: tag,
    }
  }

  it('keeps the live selection and measured box on the restored node', () => {
    manager.record(snapshot('before'))
    manager.record(snapshot('after'))

    manager.undo()

    const restored = h.rfSetNodes.mock.calls.at(-1)?.[0][0]
    expect(restored.data.title).toBe('before') // authored content from the snapshot…
    expect(restored.selected).toBe(true) // …interaction state from the canvas
    expect(restored.measured).toEqual({ width: 200, height: 80 })
  })

  it('leaves a node the live canvas does not have without interaction state', () => {
    const undoingADelete = {
      action: 'workflow_event',
      store: 'workflow',
      data: { event: 'NodeDelete', nodes: [{ id: 'gone', data: {} }], edges: [] },
      label: 'restores a deleted node',
    }
    manager.record(undoingADelete)
    manager.record(snapshot('after'))

    manager.undo()

    const restored = h.rfSetNodes.mock.calls.at(-1)?.[0][0]
    expect(restored.id).toBe('gone')
    expect(restored.selected).toBeUndefined()
  })
})
