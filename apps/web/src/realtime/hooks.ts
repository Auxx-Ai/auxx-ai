// ~/realtime/hooks.ts

'use client'

import type {
  ChannelLens,
  PresenceHandlers,
  PresenceMember,
  SubscribeHandlers,
} from '@auxx/lib/realtime/client'
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
 * Handlers for a multi-room subscription. Extends the adapter's
 * {@link SubscribeHandlers} with a room-identified subscribe callback — the
 * plain `onSubscribed` fires once per room but says nothing about *which*
 * room, which a per-key catch-up needs.
 */
export interface RoomsHandlers extends SubscribeHandlers {
  /**
   * Fired for each room as it completes its subscribe handshake — and again
   * on every resubscribe (Pusher refires `pusher:subscription_succeeded`
   * after a reconnect). Use it to catch up on events published while that
   * specific room was unsubscribed.
   */
  onRoomSubscribed?(roomKey: string): void
}

/**
 * Subscribe to many rooms at once by key. Manages add/remove as the requested
 * set changes and refcounts through the adapter, so overlapping callers are
 * safe. Returns the set of currently-subscribed room keys for the requested
 * keys only (filtered from the adapter's global room map).
 *
 * The returned set is referentially stable until either the requested key set
 * changes or the adapter's subscribed-room contents change for those keys —
 * required by the `useSyncExternalStore` snapshot contract.
 *
 * Room keys never contain a comma, so the requested set is tracked as one
 * sorted comma-joined string; a caller may therefore rebuild its key array on
 * every render without re-subscribing.
 */
export function useRealtimeRooms(
  roomKeys: readonly string[],
  handlers?: RoomsHandlers
): ReadonlySet<string> {
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  const roomsKey = useMemo(() => [...roomKeys].sort().join(','), [roomKeys])

  useEffect(() => {
    if (!roomsKey) return
    const subs = roomsKey.split(',').map((roomKey) =>
      realtimeAdapter.subscribe(roomKey, {
        onEvent: (event, payload) => handlersRef.current?.onEvent?.(event, payload),
        onSubscribed: () => {
          handlersRef.current?.onSubscribed?.()
          handlersRef.current?.onRoomSubscribed?.(roomKey)
        },
      })
    )
    return () => {
      for (const s of subs) s.unsubscribe()
    }
  }, [roomsKey])

  // Set of room keys we care about for this hook instance.
  const requestedKeys = useMemo<ReadonlySet<string>>(
    () => (roomsKey ? new Set(roomsKey.split(',')) : EMPTY_ROOM_SET),
    [roomsKey]
  )

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

/** Handlers for the per-def record channels. */
export interface RecordChannelHandlers extends SubscribeHandlers {
  /**
   * Fired with the entity-definition id of each record channel as it finishes
   * subscribing — and again after a reconnect resubscribes it. The window
   * between mount and this callback is one in which Pusher delivers nothing,
   * so a consumer holding data for that def must reconcile it here.
   */
  onDefSubscribed?(entityDefinitionId: string): void
}

/**
 * Subscribe to the per-def record channels for a set of entity definitions
 * (plan v3/03 §8.1). Record-family events (`record:*`, `fieldValues:updated`,
 * `records:invalidated`) are published per def and each channel is ACL'd on
 * `canViewEntity`, so a def the member cannot view simply fails auth.
 */
export function useRecordChannels(
  entityDefinitionIds: readonly string[],
  handlers?: RecordChannelHandlers
): ReadonlySet<string> {
  const { organizationId } = useUser()
  // Room keys plus the reverse map, derived together so `onRoomSubscribed`
  // can name the def without re-parsing the key format.
  const { roomKeys, defByRoomKey } = useMemo(() => {
    const keys: string[] = []
    const byKey = new Map<string, string>()
    if (organizationId) {
      for (const defId of new Set(entityDefinitionIds)) {
        const key = rooms.orgRecords(organizationId, defId)
        keys.push(key)
        byKey.set(key, defId)
      }
    }
    return { roomKeys: keys, defByRoomKey: byKey }
  }, [organizationId, entityDefinitionIds])

  return useRealtimeRooms(roomKeys, {
    onEvent: handlers?.onEvent,
    onSubscribed: handlers?.onSubscribed,
    onRoomSubscribed: (roomKey) => {
      const defId = defByRoomKey.get(roomKey)
      if (defId) handlers?.onDefSubscribed?.(defId)
    },
  })
}

/** One per-lens inbox channel subscription request (mail-permissions §6.4). */
export interface InboxChannelEntry {
  /** Raw inbox UUID, or `'none'` for the residual triage channel. */
  slug: string
  /** The caller's lens on that inbox — subscribe to exactly this variant. */
  lens: ChannelLens
}

/**
 * Subscribe to a single per-lens inbox channel. The hook refcounts
 * subscriptions so multiple components can call it safely.
 */
export function useInboxChannel(
  entry: InboxChannelEntry | null | undefined,
  handlers?: SubscribeHandlers
): boolean {
  const { organizationId } = useUser()
  const roomKey =
    organizationId && entry ? rooms.orgInbox(organizationId, entry.slug, entry.lens) : null
  return useRealtimeRoom(roomKey, handlers ?? {})
}

/**
 * Subscribe to many per-lens inbox channels at once — a thin mapping over
 * {@link useRealtimeRooms}, which owns the add/remove + snapshot machinery.
 * Returns the set of currently-subscribed room keys for the requested entries.
 */
export function useInboxChannels(
  entries: readonly InboxChannelEntry[],
  handlers?: SubscribeHandlers
): ReadonlySet<string> {
  const { organizationId } = useUser()
  const roomKeys = useMemo(
    () =>
      organizationId
        ? entries.map((e) => rooms.orgInbox(organizationId, e.slug, e.lens))
        : ([] as string[]),
    [organizationId, entries]
  )
  return useRealtimeRooms(roomKeys, handlers)
}

const EMPTY_ROOM_SET: ReadonlySet<string> = new Set()
