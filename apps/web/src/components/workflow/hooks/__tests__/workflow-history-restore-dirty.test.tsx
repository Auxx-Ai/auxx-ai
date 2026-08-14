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
}))

vi.mock('@xyflow/react', () => ({
  useStoreApi: () => ({
    getState: () => ({ setNodes: h.rfSetNodes, setEdges: h.rfSetEdges, nodes: [], edges: [] }),
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
