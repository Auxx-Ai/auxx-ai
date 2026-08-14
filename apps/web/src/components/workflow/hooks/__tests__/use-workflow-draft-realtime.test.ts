// apps/web/src/components/workflow/hooks/__tests__/use-workflow-draft-realtime.test.ts
//
// The `workflow:draft-updated` subscriber (Kopilot workflow capability, 4b):
// on a CLEAN canvas it refetches the draft, rehydrates through the shared
// `applyFetchedWorkflow` mapping, replaces the canvas via the
// `workflow:externalUpdate` bus seam, and records ONE immediate (non-debounced)
// full-snapshot history entry so the Kopilot turn is a normal Cmd+Z step. On a
// DIRTY canvas the event is ignored — local unsaved work must never be
// clobbered, not even by a `system` (turn-revert) event.

import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  orgHandlers: null as null | { onEvent?: (event: string, payload: unknown) => void },
  storeState: { workflowAppId: 'wfapp-1' as string | null, isDirty: false },
  applyFetchedWorkflow: vi.fn(),
  record: vi.fn(),
  emit: vi.fn(),
}))

vi.mock('~/realtime/hooks', () => ({
  useOrgChannel: (handlers?: { onEvent?: (event: string, payload: unknown) => void }) => {
    h.orgHandlers = handlers ?? null
    return true
  },
}))

vi.mock('../../store/workflow-store', () => ({
  useWorkflowStore: { getState: () => h.storeState },
}))

vi.mock('../../store/workflow-store-provider', () => ({
  useHistoryManager: () => ({ record: h.record }),
}))

vi.mock('../../store/event-bus', () => ({
  storeEventBus: { emit: (...args: unknown[]) => h.emit(...args) },
}))

vi.mock('../use-workflow-init', () => ({
  applyFetchedWorkflow: (...args: unknown[]) => h.applyFetchedWorkflow(...args),
}))

import { useWorkflowDraftRealtime } from '../use-workflow-draft-realtime'

const FETCHED = { id: 'wf-row', workflowAppId: 'wfapp-1', graph: { nodes: [], edges: [] } }
const APPLIED = {
  nodes: [{ id: 'n1', position: { x: 0, y: 0 }, data: { title: 'Wait' } }],
  edges: [{ id: 'e1', source: 'n1', target: 'n2', data: { _derived: true } }],
  viewport: null,
  metadata: { id: 'wf-row' },
}

/** Emit a draft-updated event and wait for the rehydrate to record. */
async function fire(payload: unknown) {
  const recordedBefore = h.record.mock.calls.length
  h.orgHandlers?.onEvent?.('workflow:draft-updated', payload)
  await vi.waitFor(() => {
    expect(h.record.mock.calls.length).toBeGreaterThan(recordedBefore)
  })
}

beforeEach(() => {
  h.orgHandlers = null
  h.storeState = { workflowAppId: 'wfapp-1', isDirty: false }
  h.applyFetchedWorkflow.mockReset().mockReturnValue(APPLIED)
  h.record.mockReset()
  h.emit.mockReset()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => FETCHED }))
  )
  renderHook(() => useWorkflowDraftRealtime())
})

describe('useWorkflowDraftRealtime', () => {
  it('clean canvas ⇒ refetch, rehydrate via applyFetchedWorkflow, replace canvas, ONE history entry', async () => {
    await fire({ workflowAppId: 'wfapp-1', reason: 'kopilot' })

    expect(fetch).toHaveBeenCalledWith('/api/workflows/wfapp-1')
    expect(h.applyFetchedWorkflow).toHaveBeenCalledTimes(1)
    expect(h.applyFetchedWorkflow).toHaveBeenCalledWith(FETCHED)

    // Canvas replacement rides the same external-update seam initial load's
    // canvas listens on — no hand-rolled second graph→store mapping.
    expect(h.emit).toHaveBeenCalledWith({
      type: 'workflow:externalUpdate',
      data: { nodes: APPLIED.nodes, edges: APPLIED.edges },
    })

    // ONE immediate full-snapshot entry, `workflow_event` shape — the same
    // shape `use-save-to-history` records, so undo restores it identically.
    expect(h.record).toHaveBeenCalledTimes(1)
    const entry = h.record.mock.calls[0][0]
    expect(entry.action).toBe('workflow_event')
    expect(entry.store).toBe('workflow')
    expect(entry.label).toBe('Kopilot edit')
    expect(entry.data.nodes).toEqual(APPLIED.nodes)
    expect(entry.data.edges).toEqual(APPLIED.edges)
    // Snapshots are clones — later canvas mutations must not rewrite history.
    expect(entry.data.nodes[0]).not.toBe(APPLIED.nodes[0])
    expect(entry.data.edges[0]).not.toBe(APPLIED.edges[0])
  })

  it("reason 'system' ⇒ neutral label", async () => {
    await fire({ workflowAppId: 'wfapp-1', reason: 'system' })
    expect(h.record).toHaveBeenCalledTimes(1)
    expect(h.record.mock.calls[0][0].label).toBe('Workflow updated')
  })

  it('dirty canvas ⇒ the event is ignored entirely', async () => {
    h.storeState.isDirty = true
    h.orgHandlers?.onEvent?.('workflow:draft-updated', {
      workflowAppId: 'wfapp-1',
      reason: 'system',
    })
    await Promise.resolve()
    expect(fetch).not.toHaveBeenCalled()
    expect(h.record).not.toHaveBeenCalled()
    expect(h.emit).not.toHaveBeenCalled()
  })

  it('event for a different workflow ⇒ ignored', async () => {
    h.orgHandlers?.onEvent?.('workflow:draft-updated', {
      workflowAppId: 'other',
      reason: 'kopilot',
    })
    await Promise.resolve()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('other realtime events ⇒ ignored', async () => {
    h.orgHandlers?.onEvent?.('tableView:changed', { workflowAppId: 'wfapp-1' })
    await Promise.resolve()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('canvas goes dirty while the fetch is in flight ⇒ local work wins, nothing applied', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        // The user starts editing between the event and the response.
        h.storeState.isDirty = true
        return { ok: true, json: async () => FETCHED }
      })
    )
    h.orgHandlers?.onEvent?.('workflow:draft-updated', {
      workflowAppId: 'wfapp-1',
      reason: 'kopilot',
    })
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled())
    await Promise.resolve()
    await Promise.resolve()
    expect(h.applyFetchedWorkflow).not.toHaveBeenCalled()
    expect(h.record).not.toHaveBeenCalled()
  })

  it('a burst of events coalesces into an initial fetch plus one trailing re-run', async () => {
    let resolveFirst: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      resolveFirst = resolve
    })
    const fetchMock = vi.fn(async () => {
      if (fetchMock.mock.calls.length === 1) await gate
      return { ok: true, json: async () => FETCHED }
    })
    vi.stubGlobal('fetch', fetchMock)

    // Three events land while the first fetch hangs.
    h.orgHandlers?.onEvent?.('workflow:draft-updated', {
      workflowAppId: 'wfapp-1',
      reason: 'kopilot',
    })
    h.orgHandlers?.onEvent?.('workflow:draft-updated', {
      workflowAppId: 'wfapp-1',
      reason: 'kopilot',
    })
    h.orgHandlers?.onEvent?.('workflow:draft-updated', {
      workflowAppId: 'wfapp-1',
      reason: 'kopilot',
    })
    resolveFirst?.()

    await vi.waitFor(() => expect(h.record).toHaveBeenCalledTimes(2))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
