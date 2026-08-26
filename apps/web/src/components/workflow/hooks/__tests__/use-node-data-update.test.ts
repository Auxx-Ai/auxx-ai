// apps/web/src/components/workflow/hooks/__tests__/use-node-data-update.test.ts
//
// `node.data`'s object identity is load-bearing far beyond the render it
// triggers: the app panel pushes data INTO its iframe on every identity change,
// the iframe re-renders and echoes back, and the echo used to be written
// straight back out again. That cycle ran at ~1 Hz for as long as an app panel
// was open, queueing an autosave and an undo entry on every turn
// (plans/kopilot/workflow/29-app-panel-write-loop.md).
//
// So a write that changes nothing must do nothing — not "cheaply re-render",
// nothing. These tests pin that, and pin that a real change still goes through.

import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  nodes: [] as any[],
  setNodes: vi.fn(),
  debouncedSave: vi.fn(),
  saveStateToHistory: vi.fn(),
  isReadOnly: false,
}))

vi.mock('@xyflow/react', () => ({
  useStoreApi: () => ({ getState: () => ({ nodes: h.nodes, setNodes: h.setNodes }) }),
  useStore: (selector: any) => selector({ nodes: h.nodes }),
}))

vi.mock('../use-read-only', () => ({ useReadOnly: () => ({ isReadOnly: h.isReadOnly }) }))

vi.mock('../use-workflow-save', () => ({
  useWorkflowSave: () => ({ debouncedSave: h.debouncedSave }),
}))

vi.mock('../use-save-to-history', () => ({
  useWorkflowHistory: () => ({ saveStateToHistory: h.saveStateToHistory }),
  WorkflowHistoryEvent: { NodeChange: 'NodeChange' },
}))

const { useNodeCrud } = await import('../use-node-data-update')

const NODE_ID = 'n1'

function seed(data: Record<string, unknown>) {
  h.nodes = [{ id: NODE_ID, data }]
}

describe('useNodeCrud — no-op writes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.isReadOnly = false
    seed({ operation: 'get', resource: 'order' })
  })

  it('does not touch the store, the save or the history when nothing changed', () => {
    const { result } = renderHook(() => useNodeCrud(NODE_ID, h.nodes[0].data))

    result.current.setInputs({ operation: 'get', resource: 'order' })

    expect(h.setNodes).not.toHaveBeenCalled()
    expect(h.debouncedSave).not.toHaveBeenCalled()
    expect(h.saveStateToHistory).not.toHaveBeenCalled()
  })

  it('ignores a patch that only repeats values already present', () => {
    const { result } = renderHook(() => useNodeCrud(NODE_ID, h.nodes[0].data))

    // The comparison must be on the MERGED result, not on the patch: a partial
    // patch of existing values merges to exactly what is already stored.
    result.current.setInputs({ operation: 'get' })

    expect(h.setNodes).not.toHaveBeenCalled()
    expect(h.debouncedSave).not.toHaveBeenCalled()
  })

  it('ignores repeated identical writes at the app-panel loop cadence', () => {
    const { result } = renderHook(() => useNodeCrud(NODE_ID, h.nodes[0].data))

    const echo = { operation: 'get', resource: 'order', _computedOutputs: { total: 'number' } }
    result.current.setInputs(echo)
    // First one is a real change; the store now holds it.
    expect(h.setNodes).toHaveBeenCalledTimes(1)
    seed(h.setNodes.mock.calls[0][0][0].data)

    for (let tick = 0; tick < 5; tick++) {
      result.current.setInputs({ ...echo })
    }

    expect(h.setNodes).toHaveBeenCalledTimes(1)
    expect(h.debouncedSave).toHaveBeenCalledTimes(1)
    expect(h.saveStateToHistory).toHaveBeenCalledTimes(1)
  })

  it('key order does not make a write look like a change', () => {
    const { result } = renderHook(() => useNodeCrud(NODE_ID, h.nodes[0].data))

    result.current.setInputs({ resource: 'order', operation: 'get' })

    expect(h.setNodes).not.toHaveBeenCalled()
  })

  it('still writes, saves and records when something genuinely changed', () => {
    const { result } = renderHook(() => useNodeCrud(NODE_ID, h.nodes[0].data))

    result.current.setInputs({ operation: 'list', resource: 'order' })

    expect(h.setNodes).toHaveBeenCalledTimes(1)
    expect(h.debouncedSave).toHaveBeenCalledTimes(1)
    expect(h.saveStateToHistory).toHaveBeenCalledWith('NodeChange', {
      nodeId: NODE_ID,
      coalesceKey: `NodeChange:${NODE_ID}`,
    })
  })

  it('a nested value change is still a change', () => {
    seed({ config: { fields: ['a', 'b'] } })
    const { result } = renderHook(() => useNodeCrud(NODE_ID, h.nodes[0].data))

    result.current.setInputs({ config: { fields: ['a', 'c'] } })

    expect(h.setNodes).toHaveBeenCalledTimes(1)
  })

  it('read-only writes nothing at all', () => {
    h.isReadOnly = true
    const { result } = renderHook(() => useNodeCrud(NODE_ID, h.nodes[0].data))

    result.current.setInputs({ operation: 'list' })

    expect(h.setNodes).not.toHaveBeenCalled()
    expect(h.debouncedSave).not.toHaveBeenCalled()
  })
})
