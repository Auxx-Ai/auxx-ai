// apps/web/src/realtime/hooks.test.ts
//
// The multi-room hooks. `useRealtimeRooms` gained a room-identified subscribe
// callback for the record catch-up (P0 follow-up #1); mail rides the SAME
// machinery through `useInboxChannels`, so the inbox assertions here exist to
// keep that from regressing.

import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

interface FakeSub {
  roomKey: string
  handlers: { onEvent?: (e: string, p: unknown) => void; onSubscribed?: () => void }
  unsubscribed: boolean
}

const h = vi.hoisted(() => ({
  subs: [] as FakeSub[],
  roomMap: new Set<string>(),
}))

vi.mock('./adapter', () => ({
  realtimeAdapter: {
    subscribe: (roomKey: string, handlers: any) => {
      const sub: FakeSub = { roomKey, handlers, unsubscribed: false }
      h.subs.push(sub)
      h.roomMap.add(roomKey)
      return {
        unsubscribe: () => {
          sub.unsubscribed = true
        },
      }
    },
    getRoomMapSnapshot: () => h.roomMap,
    subscribeToRooms: () => () => {},
    getRoomSnapshot: (key: string) => h.roomMap.has(key),
    getServerRoomSnapshot: () => false,
  },
}))

vi.mock('~/hooks/use-user', () => ({ useUser: () => ({ organizationId: 'org_1' }) }))

const { useInboxChannels, useRecordChannels } = await import('./hooks')

/** Fire the adapter's subscribe-success for a room, as Pusher does. */
const fireSubscribed = (roomKey: string) => {
  for (const sub of h.subs) {
    if (sub.roomKey === roomKey && !sub.unsubscribed) sub.handlers.onSubscribed?.()
  }
}

beforeEach(() => {
  h.subs.length = 0
  h.roomMap.clear()
})

describe('useRecordChannels', () => {
  it('subscribes one room per def and names the DEF, not the room key', () => {
    const onDefSubscribed = vi.fn()
    renderHook(() => useRecordChannels(['def_a', 'def_b'], { onDefSubscribed }))

    expect(h.subs).toHaveLength(2)
    const roomA = h.subs[0]!.roomKey
    expect(roomA).toContain('def_a')

    fireSubscribed(roomA)

    expect(onDefSubscribed).toHaveBeenCalledTimes(1)
    expect(onDefSubscribed).toHaveBeenCalledWith('def_a')
  })

  it('reports every resubscribe — a reconnect refires subscription_succeeded', () => {
    const onDefSubscribed = vi.fn()
    renderHook(() => useRecordChannels(['def_a'], { onDefSubscribed }))

    fireSubscribed(h.subs[0]!.roomKey)
    fireSubscribed(h.subs[0]!.roomKey)

    expect(onDefSubscribed).toHaveBeenCalledTimes(2)
  })

  it('routes events per def channel and tears the rooms down on unmount', () => {
    const onEvent = vi.fn()
    const { unmount } = renderHook(() => useRecordChannels(['def_a', 'def_b'], { onEvent }))

    h.subs[1]!.handlers.onEvent?.('record:updated', { id: 'r1' })
    expect(onEvent).toHaveBeenCalledWith('record:updated', { id: 'r1' })

    unmount()
    expect(h.subs.every((s) => s.unsubscribed)).toBe(true)
  })
})

describe('useInboxChannels (mail — must not regress)', () => {
  it('still subscribes one room per lens entry and fires onSubscribed per room', () => {
    const onSubscribed = vi.fn()
    const onEvent = vi.fn()
    renderHook(() =>
      useInboxChannels(
        [
          { slug: 'inbox_1', lens: 'full' as never },
          { slug: 'none', lens: 'metadata' as never },
        ],
        { onEvent, onSubscribed }
      )
    )

    expect(h.subs).toHaveLength(2)
    expect(h.subs[0]!.roomKey).toContain('inbox_1')

    // Mail coalesces this burst into one catch-up — it must still get one call
    // per room, and no `onRoomSubscribed`-shaped argument breaks that.
    for (const sub of h.subs) sub.handlers.onSubscribed?.()
    expect(onSubscribed).toHaveBeenCalledTimes(2)

    h.subs[0]!.handlers.onEvent?.('message:created', { id: 'm1' })
    expect(onEvent).toHaveBeenCalledWith('message:created', { id: 'm1' })
  })
})
