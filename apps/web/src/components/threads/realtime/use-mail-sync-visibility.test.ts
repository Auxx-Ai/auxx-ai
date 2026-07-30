// apps/web/src/components/threads/realtime/use-mail-sync-visibility.test.ts
//
// Plan 45 §3.1 — what `visibility:changed` does to an OPEN conversation.
//
// The bar this file is written to: a test that only asserts "some invalidation
// happened" passes against the pre-plan-45 handler, because that handler already
// invalidated three things and still left the redaction banner on screen. So the
// assertions here are about the two caches a tRPC invalidate provably cannot
// reach — the thread-store entry that holds `myLens`, and the message list behind
// `useMessages`' `!cachedList` gate.

import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  /** Captured room → onEvent, so a test can dispatch as the server would. */
  handlers: new Map<string, (event: string, payload: unknown) => void>(),
  invalidate: {
    myLenses: vi.fn(),
    listIds: vi.fn(),
    getCounts: vi.fn(),
  },
  listByThreadFetch: vi.fn<(input: any, opts: any) => Promise<any>>(async () => ({
    messages: [],
    total: 0,
  })),
  clearHtmlBodyCache: vi.fn(),
}))

vi.mock('~/hooks/use-user', () => ({ useUser: () => ({ user: { id: 'usr_me' } }) }))

vi.mock('../hooks', () => ({
  useMyInboxLenses: () => ({ lenses: { support: 'full' }, isAdmin: false, isLoaded: true }),
}))

vi.mock('./use-message-arrival-cue', () => ({ useMessageArrivalCue: () => vi.fn() }))

vi.mock('~/components/mail/hooks/use-html-body', () => ({
  clearHtmlBodyCache: h.clearHtmlBodyCache,
}))

vi.mock('~/realtime/hooks', () => ({
  useInboxChannels: (_entries: unknown, opts: any) => h.handlers.set('inbox', opts.onEvent),
  useOrgChannel: (opts: any) => h.handlers.set('org', opts.onEvent),
  useRealtimeRoom: (room: string | null, opts: any) => {
    if (room) h.handlers.set('user', opts.onEvent)
  },
}))

vi.mock('~/trpc/react', () => ({
  api: {
    useUtils: () => ({
      inbox: { myLenses: { invalidate: h.invalidate.myLenses } },
      thread: {
        listIds: { invalidate: h.invalidate.listIds },
        getCounts: { invalidate: h.invalidate.getCounts },
      },
      message: { listByThread: { fetch: h.listByThreadFetch } },
    }),
  },
}))

const { useMailSync } = await import('./use-mail-sync')
const { useThreadStore } = await import('../store/thread-store')
const { useThreadSelectionStore } = await import('../store/thread-selection-store')
const { useMessageListStore } = await import('../store/message-list-store')
const { useMessageStore } = await import('../store/message-store')

const thread = (id: string, myLens: string) => ({ id, subject: '', myLens }) as any

/** Dispatch `visibility:changed` on the viewer's own room, as a targeted grant does. */
const dispatchVisibilityChanged = () =>
  h.handlers.get('user')?.('visibility:changed', {
    organizationId: 'org_1',
  })

beforeEach(() => {
  h.handlers.clear()
  h.invalidate.myLenses.mockClear()
  h.invalidate.listIds.mockClear()
  h.invalidate.getCounts.mockClear()
  h.listByThreadFetch.mockClear()
  h.clearHtmlBodyCache.mockClear()
  useThreadStore.getState().reset()
  useMessageListStore.getState().reset?.()
  useMessageStore.getState().reset?.()
  useThreadSelectionStore.getState().setActiveThread(null)
})

describe('§3.1 — visibility:changed on an open thread', () => {
  it('re-requests the open thread META, which is the only source of myLens', () => {
    useThreadStore.getState().completeBatch([thread('thr_1', 'metadata')], [])
    useThreadSelectionStore.getState().setActiveThread('thr_1')
    renderHook(() => useMailSync())

    dispatchVisibilityChanged()

    // THE assertion. Delete `forceRequestThread` from the handler and this fails
    // while every invalidation assertion below still passes — which is exactly
    // how the banner survived before plan 45.
    expect(useThreadStore.getState().pendingIds.has('thr_1')).toBe(true)
    // And it did not blank the pane to do it.
    expect(useThreadStore.getState().threads.get('thr_1')).toBeDefined()
  })

  it('force-fetches the message list past the !cachedList gate', () => {
    useThreadSelectionStore.getState().setActiveThread('thr_1')
    renderHook(() => useMailSync())

    dispatchVisibilityChanged()

    expect(h.listByThreadFetch).toHaveBeenCalledWith({ threadId: 'thr_1' }, { staleTime: 0 })
  })

  it('clears the module-level HTML body cache — bodies must not survive a revoke', () => {
    useThreadSelectionStore.getState().setActiveThread('thr_1')
    renderHook(() => useMailSync())

    dispatchVisibilityChanged()

    expect(h.clearHtmlBodyCache).toHaveBeenCalled()
  })

  it('still does the three lens-wide invalidations', () => {
    renderHook(() => useMailSync())

    dispatchVisibilityChanged()

    expect(h.invalidate.myLenses).toHaveBeenCalled()
    expect(h.invalidate.listIds).toHaveBeenCalled()
    expect(h.invalidate.getCounts).toHaveBeenCalled()
  })

  it('costs a viewer with no open thread nothing beyond the invalidations', () => {
    renderHook(() => useMailSync())

    dispatchVisibilityChanged()

    expect(h.listByThreadFetch).not.toHaveBeenCalled()
    expect(useThreadStore.getState().pendingIds.size).toBe(0)
  })

  it('fires on the ORG room too — a broadcast (inbox default-lens edit) refreshes as well', () => {
    useThreadStore.getState().completeBatch([thread('thr_1', 'metadata')], [])
    useThreadSelectionStore.getState().setActiveThread('thr_1')
    renderHook(() => useMailSync())

    h.handlers.get('org')?.('visibility:changed', { organizationId: 'org_1' })

    expect(useThreadStore.getState().pendingIds.has('thr_1')).toBe(true)
  })
})
