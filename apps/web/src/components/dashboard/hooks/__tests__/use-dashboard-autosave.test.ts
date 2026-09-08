// apps/web/src/components/dashboard/hooks/__tests__/use-dashboard-autosave.test.ts
//
// The two guards plan v3/04 §7 added to the auto-save, and neither is optional:
//
//  - the compare-and-set token. The flush sends the WHOLE layout document, so a
//    flush holding a stale doc is a complete overwrite of whatever landed in the
//    meantime. `expectedLayoutHash` makes that a visible `ConflictError`, and
//    the conflict branch must NOT re-set `isDirty` the way a network failure
//    does: retrying the same stale doc IS the clobber.
//  - suspension for the span of a Kopilot turn, on the debounce AND on the
//    unmount flush. The unmount one is the sharpest edge: closing the tab
//    mid-turn used to push a pre-turn document over everything the agent wrote.

import type { DashboardLayoutDoc } from '@auxx/lib/dashboards/client'
import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  getFetch: vi.fn(),
  toastError: vi.fn(),
  lock: null as { turnId: string; startedAt: number } | null,
}))

vi.mock('~/trpc/react', () => ({
  api: {
    dashboard: { saveDraft: { useMutation: () => ({ mutateAsync: h.mutateAsync }) } },
    useUtils: () => ({ dashboard: { get: { fetch: h.getFetch } } }),
  },
}))

vi.mock('@auxx/ui/components/toast', () => ({ toastError: h.toastError }))

vi.mock('../use-dashboard-kopilot-turn', () => ({
  getDashboardTurnLock: () => h.lock,
}))

import { useDashboardStore } from '../../stores/dashboard-draft-store'
import { useDashboardAutosave } from '../use-dashboard-autosave'

const DOC: DashboardLayoutDoc = {
  tabs: [{ id: 'tab_1', title: 'Overview', icon: null, widgets: [] }],
}
const FRESH_DOC: DashboardLayoutDoc = {
  tabs: [{ id: 'tab_2', title: 'From the agent', icon: null, widgets: [] }],
}

/** Put the store in "editing dashboard d1, clean" and mount the hook. */
function mount(seedLayoutHash: string | null = 'hash-0') {
  useDashboardStore.setState({
    dashboardId: 'd1',
    draft: DOC,
    persisted: DOC,
    isEditMode: true,
    isDirty: false,
  })
  return renderHook(() => useDashboardAutosave({ dashboardId: 'd1', seedLayoutHash }))
}

/** Dirty the store and let the 800ms debounce fire. */
async function edit() {
  useDashboardStore.setState({ isDirty: true })
  await vi.advanceTimersByTimeAsync(900)
}

beforeEach(() => {
  vi.useFakeTimers()
  h.lock = null
  h.mutateAsync.mockReset().mockResolvedValue({ hasUnpublishedChanges: true, layoutHash: 'hash-1' })
  h.getFetch.mockReset().mockResolvedValue({
    layout: DOC,
    draftLayout: FRESH_DOC,
    draftLayoutHash: 'hash-server',
    hasUnpublishedChanges: true,
  })
  h.toastError.mockReset()
  useDashboardStore.getState().reset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useDashboardAutosave CAS token', () => {
  it('sends the hash the page seeded from, then chains the one the save returned', async () => {
    mount('hash-0')

    await edit()
    expect(h.mutateAsync).toHaveBeenCalledWith({
      id: 'd1',
      doc: DOC,
      expectedLayoutHash: 'hash-0',
    })

    // The second flush must not re-read: `saveDraft` handed back the token for
    // the doc it just wrote, which is what makes a burst of edits cheap.
    h.mutateAsync.mockResolvedValue({ hasUnpublishedChanges: true, layoutHash: 'hash-2' })
    await edit()
    expect(h.mutateAsync).toHaveBeenLastCalledWith({
      id: 'd1',
      doc: DOC,
      expectedLayoutHash: 'hash-1',
    })
  })

  it('omits the token entirely for a row that has never held a draft', async () => {
    // `get` answers `null` there, and any non-null token would be a guaranteed
    // false mismatch against a stored hash that does not exist.
    mount(null)
    await edit()
    expect(h.mutateAsync).toHaveBeenCalledWith({ id: 'd1', doc: DOC })
  })
})

describe('useDashboardAutosave conflict branch', () => {
  beforeEach(() => {
    h.mutateAsync.mockRejectedValue({ data: { code: 'CONFLICT' } })
  })

  it('refetches and adopts instead of retrying the stale doc', async () => {
    mount('hash-0')
    await edit()

    expect(h.getFetch).toHaveBeenCalledWith({ id: 'd1' }, { staleTime: 0 })
    const state = useDashboardStore.getState()
    expect(state.draft).toEqual(FRESH_DOC)
    // NOT dirty. Re-setting it (what a network error does, "so a later edit
    // retries") would send the same stale doc straight back at the server.
    expect(state.isDirty).toBe(false)
    expect(h.toastError).toHaveBeenCalledTimes(1)
  })

  it('adopts the refetched hash as the next token, so the redo does not conflict again', async () => {
    mount('hash-0')
    await edit()

    h.mutateAsync.mockReset().mockResolvedValue({ hasUnpublishedChanges: true, layoutHash: 'h9' })
    await edit()
    expect(h.mutateAsync).toHaveBeenCalledWith({
      id: 'd1',
      doc: FRESH_DOC,
      expectedLayoutHash: 'hash-server',
    })
  })

  it('a NETWORK error still keeps the edit dirty so a later edit retries', async () => {
    h.mutateAsync.mockReset().mockRejectedValue(new Error('offline'))
    mount('hash-0')
    await edit()

    expect(useDashboardStore.getState().isDirty).toBe(true)
    expect(h.getFetch).not.toHaveBeenCalled()
  })
})

describe('useDashboardAutosave turn suspension', () => {
  it('does not flush while a Kopilot turn holds the lock', async () => {
    h.lock = { turnId: 't1', startedAt: 1 }
    mount('hash-0')

    await edit()
    expect(h.mutateAsync).not.toHaveBeenCalled()
    // The edit is still pending, not dropped: the next mutation after the lock
    // releases re-arms the debounce.
    expect(useDashboardStore.getState().isDirty).toBe(true)
  })

  it('the UNMOUNT flush respects the lock too', async () => {
    h.lock = { turnId: 't1', startedAt: 1 }
    const { unmount } = mount('hash-0')
    useDashboardStore.setState({ isDirty: true })

    unmount()
    await vi.advanceTimersByTimeAsync(0)

    // This is the pre-turn document. Flushing it would overwrite every widget
    // the agent wrote during the turn the user just navigated away from.
    expect(h.mutateAsync).not.toHaveBeenCalled()
  })

  it('the unmount flush still fires when no turn is running', async () => {
    const { unmount } = mount('hash-0')
    useDashboardStore.setState({ isDirty: true })

    unmount()
    await vi.advanceTimersByTimeAsync(0)

    expect(h.mutateAsync).toHaveBeenCalledWith({
      id: 'd1',
      doc: DOC,
      expectedLayoutHash: 'hash-0',
    })
  })
})
