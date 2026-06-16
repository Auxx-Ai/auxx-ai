// ~/realtime/hooks.ts

'use client'

import type { PresenceHandlers, PresenceMember, SubscribeHandlers } from '@auxx/lib/realtime/client'
import { rooms } from '@auxx/lib/realtime/client'
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { useUser } from '~/hooks/use-user'
import { realtimeAdapter } from './adapter'

/**
 * Subscribe to a single realtime room by key. Pass handlers; the hook
 * refcounts the underlying Pusher channel and tears it down on unmount.
 *
 * Returns `true` once the channel is bound (so consumers can gate UI on it).
 */
export function useRealtimeRoom(
  roomKey: string | null | undefined,
  handlers: SubscribeHandlers
): boolean {
  // Keep the latest handlers in a ref so we can subscribe once per `roomKey`
  // without re-binding every render when callbacks change.
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  useEffect(() => {
    if (!roomKey) return
    const sub = realtimeAdapter.subscribe(roomKey, {
      onEvent: (event, payload) => handlersRef.current.onEvent?.(event, payload),
      onSubscribed: () => handlersRef.current.onSubscribed?.(),
    })
    return () => sub.unsubscribe()
  }, [roomKey])

  const getSnapshot = useCallback(
    () => (roomKey ? realtimeAdapter.getRoomSnapshot(roomKey) : false),
    [roomKey]
  )
  const getServerSnapshot = useCallback(
    () => (roomKey ? realtimeAdapter.getServerRoomSnapshot(roomKey) : false),
    [roomKey]
  )
  return useSyncExternalStore(realtimeAdapter.subscribeToRooms, getSnapshot, getServerSnapshot)
}

/**
 * Subscribe to a presence room. Same refcount semantics as `useRealtimeRoom`,
 * plus member tracking handlers. The `self` member payload is mostly
 * informational — Pusher derives presence-self from the auth response.
 */
export function usePresence(
  roomKey: string | null | undefined,
  self: PresenceMember,
  handlers: PresenceHandlers
): boolean {
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers
  const selfRef = useRef(self)
  selfRef.current = self

  useEffect(() => {
    if (!roomKey) return
    const sub = realtimeAdapter.subscribePresence(roomKey, selfRef.current, {
      onEvent: (e, p) => handlersRef.current.onEvent?.(e, p),
      onMembers: (members) => handlersRef.current.onMembers?.(members),
      onJoin: (m) => handlersRef.current.onJoin?.(m),
      onLeave: (id) => handlersRef.current.onLeave?.(id),
      onMemberUpdate: (m) => handlersRef.current.onMemberUpdate?.(m),
    })
    return () => sub.unsubscribe()
  }, [roomKey])

  const getSnapshot = useCallback(
    () => (roomKey ? realtimeAdapter.getRoomSnapshot(roomKey) : false),
    [roomKey]
  )
  const getServerSnapshot = useCallback(
    () => (roomKey ? realtimeAdapter.getServerRoomSnapshot(roomKey) : false),
    [roomKey]
  )
  return useSyncExternalStore(realtimeAdapter.subscribeToRooms, getSnapshot, getServerSnapshot)
}

/** Subscribe to connection state. Re-renders only on connect/disconnect. */
export function useRealtimeConnected(): boolean {
  return useSyncExternalStore(
    realtimeAdapter.subscribeToConnection,
    realtimeAdapter.getConnectionSnapshot,
    realtimeAdapter.getServerConnectionSnapshot
  )
}

/** Non-reactive read of current socket ID (for headers, not rendering). */
export function getRealtimeSocketId(): string | undefined {
  return realtimeAdapter.getSocketId()
}

/**
 * Subscribe to the org presence channel. Listen to events via the returned
 * handler registration; the hook refcounts so multiple call sites are safe.
 *
 * Returns `true` once the channel is bound.
 */
export function useOrgChannel(handlers?: SubscribeHandlers): boolean {
  const { organizationId } = useUser()
  const roomKey = organizationId ? rooms.orgPresence(organizationId) : null
  return useRealtimeRoom(roomKey, handlers ?? {})
}

/**
 * Subscribe to a single inbox channel by slug. Pass `'none'` for the
 * unassigned-triage channel. The hook refcounts subscriptions so multiple
 * components can call it safely.
 */
export function useInboxChannel(
  inboxSlug: string | null | undefined,
  handlers?: SubscribeHandlers
): boolean {
  const { organizationId } = useUser()
  const roomKey = organizationId && inboxSlug ? rooms.orgInbox(organizationId, inboxSlug) : null
  return useRealtimeRoom(roomKey, handlers ?? {})
}

/**
 * Subscribe to many inbox channels at once. Manages add/remove based on the
 * given slugs. Returns the set of currently-subscribed room keys for the
 * requested slugs only (filtered from the adapter's global room map).
 *
 * The returned set is referentially stable until either the requested slug
 * set changes or the adapter's subscribed-room contents change for those
 * slugs — required by the `useSyncExternalStore` snapshot contract.
 *
 * Always include `'none'` in the slug set if you want unassigned-triage events.
 */
export function useInboxChannels(
  slugs: readonly string[],
  handlers?: SubscribeHandlers
): ReadonlySet<string> {
  const { organizationId } = useUser()
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  // Stable comma-joined key so the effect only re-runs when the slug set changes.
  const slugKey = useMemo(() => [...slugs].sort().join(','), [slugs])

  useEffect(() => {
    if (!organizationId || !slugKey) return
    const list = slugKey.split(',')
    const subs = list.map((slug) =>
      realtimeAdapter.subscribe(rooms.orgInbox(organizationId, slug), {
        onEvent: (event, payload) => handlersRef.current?.onEvent?.(event, payload),
        onSubscribed: () => handlersRef.current?.onSubscribed?.(),
      })
    )
    return () => {
      for (const s of subs) s.unsubscribe()
    }
  }, [organizationId, slugKey])

  // Set of room keys we care about for this hook instance.
  const requestedKeys = useMemo<ReadonlySet<string>>(() => {
    if (!organizationId || !slugKey) return EMPTY_ROOM_SET
    return new Set(slugKey.split(',').map((slug) => rooms.orgInbox(organizationId, slug)))
  }, [organizationId, slugKey])

  // Cache the last returned snapshot so identity stays stable until the
  // filtered membership actually changes. `useSyncExternalStore` requires the
  // snapshot fn to return the same reference for unchanged state.
  const lastSnapshotRef = useRef<ReadonlySet<string>>(EMPTY_ROOM_SET)

  const getSnapshot = useCallback((): ReadonlySet<string> => {
    const all = realtimeAdapter.getRoomMapSnapshot()
    const next = new Set<string>()
    for (const key of requestedKeys) {
      if (all.has(key)) next.add(key)
    }
    const prev = lastSnapshotRef.current
    if (prev.size === next.size) {
      let same = true
      for (const k of next) {
        if (!prev.has(k)) {
          same = false
          break
        }
      }
      if (same) return prev
    }
    lastSnapshotRef.current = next
    return next
  }, [requestedKeys])

  const getServerSnapshot = useCallback((): ReadonlySet<string> => EMPTY_ROOM_SET, [])

  return useSyncExternalStore(realtimeAdapter.subscribeToRooms, getSnapshot, getServerSnapshot)
}

const EMPTY_ROOM_SET: ReadonlySet<string> = new Set()
