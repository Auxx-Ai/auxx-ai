// apps/web/src/components/dashboard/hooks/__tests__/use-dashboard-draft-realtime.test.ts
//
// The `dashboard:draft-updated` subscriber (plan v3/04 §5). On a CLEAN canvas
// it refetches `dashboard.get` and adopts the result; on a DIRTY one it does
// nothing, because unsaved local work must never be clobbered, not even by a
// `system` (turn-revert) event.
//
// The two behaviours worth a regression test are the ones that are not obvious:
// a turn publishes one event per mutation, so the burst has to coalesce onto
// the FINAL server state; and the dirty/dashboard checks have to run again
// AFTER the await, because both can change while the fetch is in flight.

import type { DashboardLayoutDoc } from '@auxx/lib/dashboards/client'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  orgHandlers: null as null | { onEvent?: (event: string, payload: unknown) => void },
  getFetch: vi.fn(),
}))

vi.mock('~/realtime/hooks', () => ({
  useOrgChannel: (handlers?: { onEvent?: (event: string, payload: unknown) => void }) => {
    h.orgHandlers = handlers ?? null
    return true
  },
}))

vi.mock('~/trpc/react', () => ({
  api: { useUtils: () => ({ dashboard: { get: { fetch: h.getFetch } } }) },
}))

import { useDashboardStore } from '../../stores/dashboard-draft-store'
import { useDashboardDraftRealtime } from '../use-dashboard-draft-realtime'

const doc = (tabId: string): DashboardLayoutDoc => ({
  tabs: [{ id: tabId, title: tabId, icon: null, widgets: [] }],
})

const response = (tabId: string) => ({
  layout: doc('published'),
  draftLayout: doc(tabId),
  draftLayoutHash: `hash-${tabId}`,
  hasUnpublishedChanges: true,
})

function fire(payload: unknown) {
  h.orgHandlers?.onEvent?.('dashboard:draft-updated', payload)
}

/** Mount the subscriber for a member with (or without) edit access. */
function mount(canEdit = true) {
  return renderHook(() => useDashboardDraftRealtime('d1', canEdit))
}

beforeEach(() => {
  h.orgHandlers = null
  h.getFetch.mockReset().mockResolvedValue(response('agent'))
  useDashboardStore.getState().reset()
  useDashboardStore.setState({
    dashboardId: 'd1',
    draft: doc('local'),
    persisted: doc('published'),
    isEditMode: true,
    isDirty: false,
  })
  renderHook(() => useDashboardDraftRealtime('d1', true))
})

describe('useDashboardDraftRealtime', () => {
  it('clean canvas ⇒ refetch and adopt the server draft', async () => {
    mount()
    fire({ dashboardId: 'd1', reason: 'kopilot' })
    await vi.waitFor(() => expect(h.getFetch).toHaveBeenCalledWith({ id: 'd1' }, { staleTime: 0 }))

    const state = useDashboardStore.getState()
    expect(state.draft).toEqual(doc('agent'))
    // `adoptDraft` clears dirty and drops into edit mode: the whole seam.
    expect(state.isDirty).toBe(false)
    expect(state.isEditMode).toBe(true)
  })

  it('dirty canvas ⇒ ignored, even for a `system` event', async () => {
    mount()
    useDashboardStore.setState({ isDirty: true })
    fire({ dashboardId: 'd1', reason: 'system' })
    await vi.waitFor(() => expect(h.getFetch).not.toHaveBeenCalled())
    expect(useDashboardStore.getState().draft).toEqual(doc('local'))
  })

  it('a VIEWER is never adopted into the draft', async () => {
    // `adoptDraft` sets `isEditMode: true`, which swaps a read-only member's
    // canvas from the published version to an unpublished draft they cannot
    // toggle back from. A draft write does not change what their view renders,
    // so there is nothing for them to refresh.
    mount(false)
    fire({ dashboardId: 'd1', reason: 'kopilot' })
    await vi.waitFor(() => expect(h.getFetch).not.toHaveBeenCalled())
    expect(useDashboardStore.getState().draft).toEqual(doc('local'))
    expect(useDashboardStore.getState().isEditMode).toBe(true)
  })

  it('ignores another dashboard’s event', async () => {
    mount()
    fire({ dashboardId: 'd2', reason: 'kopilot' })
    await vi.waitFor(() => expect(h.getFetch).not.toHaveBeenCalled())
  })

  it('coalesces a burst onto the FINAL server state', async () => {
    mount()
    // One fetch in flight; the three events landing behind it queue exactly one
    // trailing re-run, so the page ends on the last response and not an
    // intermediate one.
    let release: ((value: unknown) => void) | null = null
    h.getFetch.mockReset().mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve
        })
    )

    fire({ dashboardId: 'd1', reason: 'kopilot' })
    await vi.waitFor(() => expect(release).not.toBeNull())

    h.getFetch.mockResolvedValue(response('final'))
    fire({ dashboardId: 'd1', reason: 'kopilot' })
    fire({ dashboardId: 'd1', reason: 'kopilot' })
    fire({ dashboardId: 'd1', reason: 'kopilot' })

    release?.(response('first'))
    await vi.waitFor(() => expect(useDashboardStore.getState().draft).toEqual(doc('final')))
    // One in-flight fetch plus ONE trailing re-run, not one per event.
    expect(h.getFetch).toHaveBeenCalledTimes(2)
  })

  it('a local edit made DURING the fetch wins', async () => {
    mount()
    let release: ((value: unknown) => void) | null = null
    h.getFetch.mockReset().mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve
        })
    )

    fire({ dashboardId: 'd1', reason: 'kopilot' })
    await vi.waitFor(() => expect(release).not.toBeNull())

    // The user typed while the response was on the wire. Re-checking only
    // BEFORE the await would adopt over it.
    useDashboardStore.setState({ draft: doc('typed'), isDirty: true })
    release?.(response('agent'))
    await vi.waitFor(() => expect(h.getFetch).toHaveBeenCalledTimes(1))

    expect(useDashboardStore.getState().draft).toEqual(doc('typed'))
  })

  it('a dashboard switch DURING the fetch makes the response stale', async () => {
    mount()
    let release: ((value: unknown) => void) | null = null
    h.getFetch.mockReset().mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve
        })
    )

    fire({ dashboardId: 'd1', reason: 'kopilot' })
    await vi.waitFor(() => expect(release).not.toBeNull())

    useDashboardStore.setState({ dashboardId: 'd2', draft: doc('other') })
    release?.(response('agent'))
    await vi.waitFor(() => expect(h.getFetch).toHaveBeenCalledTimes(1))

    expect(useDashboardStore.getState().draft).toEqual(doc('other'))
  })
})
