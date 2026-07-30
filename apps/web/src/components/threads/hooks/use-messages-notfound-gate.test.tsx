// apps/web/src/components/threads/hooks/use-messages-notfound-gate.test.tsx
//
// `listByThread` answers a lens denial with NOT_FOUND, and a 404 is not a state
// this query recovers from by asking again. Its own `!cachedList` gate cannot
// stop it — no list is cached precisely BECAUSE the fetch failed — so the query
// stayed armed and refired on every focus, remount and realtime reconnect.
//
// The gate reads the thread store's tombstone rather than the query's own error,
// because three of the four `useMessages` callers pass no `enabled` at all
// (`chat-panel/messages`, `thread-messages`, `use-thread-counterparty`). Only
// `thread-details` gates on `!!thread`, so the eviction alone would not disarm
// the others.

import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  lists: new Map<string, unknown>(),
  notFoundIds: new Set<string>(),
  lastOptions: undefined as { enabled?: boolean } | undefined,
}))

vi.mock('~/trpc/react', () => ({
  api: {
    message: {
      listByThread: {
        useQuery: (_input: unknown, options: { enabled?: boolean }) => {
          h.lastOptions = options
          return { data: undefined, isLoading: false, refetch: vi.fn() }
        },
      },
    },
  },
}))

vi.mock('../store', () => ({
  useMessageListStore: (selector: (s: unknown) => unknown) =>
    selector({ lists: h.lists, setList: vi.fn() }),
  useMessageStore: (selector: (s: unknown) => unknown) =>
    selector({ messages: new Map(), setMessages: vi.fn() }),
  useParticipantStore: (selector: (s: unknown) => unknown) =>
    selector({ requestParticipant: vi.fn() }),
  useThreadStore: (selector: (s: unknown) => unknown) => selector({ notFoundIds: h.notFoundIds }),
}))

const { useMessages } = await import('./use-messages')

beforeEach(() => {
  h.lists = new Map()
  h.notFoundIds = new Set()
  h.lastOptions = undefined
})

describe('useMessages — the not-found gate', () => {
  it('is enabled for a thread the store has no tombstone for', () => {
    renderHook(() => useMessages({ threadId: 'thr_1' }))

    expect(h.lastOptions?.enabled).toBe(true)
  })

  it('DISARMS once the thread is tombstoned — the retry loop this fixes', () => {
    h.notFoundIds.add('thr_1')

    renderHook(() => useMessages({ threadId: 'thr_1' }))

    expect(h.lastOptions?.enabled).toBe(false)
  })

  it('disarms callers that pass no `enabled` of their own', () => {
    h.notFoundIds.add('thr_1')

    // `chat-panel/messages`, `thread-messages` and `use-thread-counterparty`
    // all call it exactly like this.
    renderHook(() => useMessages({ threadId: 'thr_1' }))

    expect(h.lastOptions?.enabled).toBe(false)
  })

  it('tombstones one thread without disarming another', () => {
    h.notFoundIds.add('thr_1')

    renderHook(() => useMessages({ threadId: 'thr_2' }))

    expect(h.lastOptions?.enabled).toBe(true)
  })

  it('re-arms when the tombstone clears — a re-grant must refetch', () => {
    h.notFoundIds.add('thr_1')
    const { rerender } = renderHook(() => useMessages({ threadId: 'thr_1' }))
    expect(h.lastOptions?.enabled).toBe(false)

    // `forceRequestThread` clears `notFoundIds`, then the batch repopulates.
    h.notFoundIds = new Set()
    rerender()

    expect(h.lastOptions?.enabled).toBe(true)
  })

  it('still respects the caller `enabled` and the cached-list gate', () => {
    renderHook(() => useMessages({ threadId: 'thr_1', enabled: false }))
    expect(h.lastOptions?.enabled).toBe(false)

    h.lists.set('thr_1', { messageIds: [], total: 0, fetchedAt: 0 })
    renderHook(() => useMessages({ threadId: 'thr_1' }))
    expect(h.lastOptions?.enabled).toBe(false)
  })
})
