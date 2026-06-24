// @auxx/lib/realtime/client/adapters/pusher.ts

import Pusher from 'pusher-js'
import { toPusherChannel } from '../../room-keys'
import type {
  PresenceHandlers,
  PresenceMember,
  RealtimeAdapter,
  SubscribeHandlers,
  Subscription,
} from '../types'

interface RoomEntry {
  channel: Pusher.Channel
  refCount: number
  /** Bound event names so we can `unbind` cleanly on teardown. */
  handlers: Set<SubscribeHandlers | PresenceHandlers>
  /** Catch-all bind for `onEvent` — we use `bind_global` once per channel. */
  globalListener?: (event: string, payload: unknown) => void
  /** Presence-only listeners we attached for cleanup. */
  presenceListeners?: {
    onSubscriptionSucceeded?: () => void
    onMemberAdded?: (member: { id: string; info?: Record<string, unknown> }) => void
    onMemberRemoved?: (member: { id: string }) => void
    onMemberUpdate?: (payload: { id: string; meta?: Record<string, unknown> }) => void
  }
}

const FRESH_ROOM_MAP: ReadonlySet<string> = new Set()

/**
 * Pusher-backed RealtimeAdapter.
 *
 * Internal store layout:
 *   - `rooms`: live `Map<roomKey, RoomEntry>` driving the subscription
 *   - `roomsSnapshot`: frozen `Set<roomKey>` exposed to `useSyncExternalStore`
 *     (replaced with a new reference on every membership change so React
 *     re-renders, but identity-stable across no-op state changes).
 */
interface PendingSubscription {
  roomKey: string
  handlers: SubscribeHandlers | PresenceHandlers
  presence: boolean
  realSub: Subscription | null
  cancelled: boolean
}

export class PusherRealtimeAdapter implements RealtimeAdapter {
  private pusher: Pusher | null = null
  private connected = false
  private authEndpoint = '/api/pusher/auth'
  private connectionListeners = new Set<() => void>()
  private rooms = new Map<string, RoomEntry>()
  private roomsSnapshot: ReadonlySet<string> = new Set()
  private roomListeners = new Set<() => void>()
  // Subscriptions requested before `connect()` ran — happens when a descendant
  // of the provider that owns the lifecycle mounts first (React fires child
  // useEffects before parent's). Replayed on `connect()`.
  private pendingSubs: PendingSubscription[] = []

  connect(config: {
    key: string
    cluster: string
    authEndpoint: string
    wsHost?: string
    wsPort?: number
    forceTLS?: boolean
  }) {
    if (this.pusher) return
    this.authEndpoint = config.authEndpoint
    this.pusher = new Pusher(
      config.key,
      config.wsHost
        ? {
            // Self-hosted Sockudo (Pusher-protocol).
            wsHost: config.wsHost,
            wsPort: config.wsPort,
            wssPort: config.wsPort,
            forceTLS: config.forceTLS ?? true,
            // Gate transports on TLS so a plain-ws localhost container doesn't
            // trigger a wss upgrade retry in dev.
            enabledTransports: config.forceTLS === false ? ['ws'] : ['ws', 'wss'],
            disableStats: true,
            cluster: '',
            authEndpoint: config.authEndpoint,
          }
        : {
            // Hosted Pusher cloud (kept fallback seam).
            cluster: config.cluster,
            forceTLS: true,
            authEndpoint: config.authEndpoint,
          }
    )
    this.pusher.connection.bind('connected', () => {
      this.connected = true
      this.notifyConnection()
    })
    this.pusher.connection.bind('disconnected', () => {
      this.connected = false
      this.notifyConnection()
    })
    // Replay anything that subscribed before connect ran.
    const pending = this.pendingSubs
    this.pendingSubs = []
    for (const p of pending) {
      if (p.cancelled) continue
      p.realSub = this.subscribeInternal(p.roomKey, p.handlers, p.presence)
    }
  }

  disconnect() {
    if (!this.pusher) return
    this.pusher.disconnect()
    this.pusher = null
    this.connected = false
    this.rooms.clear()
    this.refreshRoomsSnapshot()
    this.notifyConnection()
    this.notifyRooms()
  }

  getSocketId(): string | undefined {
    return this.pusher?.connection?.socket_id
  }

  isConnected(): boolean {
    return this.connected
  }

  // ----------------------------------------------------------------------
  // Generic subscribe
  // ----------------------------------------------------------------------

  subscribe(roomKey: string, handlers: SubscribeHandlers): Subscription {
    return this.subscribeInternal(roomKey, handlers, false)
  }

  subscribePresence(
    roomKey: string,
    _self: PresenceMember,
    handlers: PresenceHandlers
  ): Subscription {
    // Pusher derives the presence-self payload from the auth response on the
    // server (`channel_data` carries the user_id + user_info); the explicit
    // `self` here is informational only.
    return this.subscribeInternal(roomKey, handlers, true)
  }

  private subscribeInternal(
    roomKey: string,
    handlers: SubscribeHandlers | PresenceHandlers,
    presence: boolean
  ): Subscription {
    if (!this.pusher) {
      // Buffer until `connect()` runs. Caller still gets a Subscription
      // whose `unsubscribe` works whether the replay happened or not.
      const pending: PendingSubscription = {
        roomKey,
        handlers,
        presence,
        realSub: null,
        cancelled: false,
      }
      this.pendingSubs.push(pending)
      return {
        unsubscribe: () => {
          pending.cancelled = true
          if (pending.realSub) {
            pending.realSub.unsubscribe()
            return
          }
          this.pendingSubs = this.pendingSubs.filter((p) => p !== pending)
        },
      }
    }
    const channelName = toPusherChannel(roomKey)
    if (!channelName) {
      // Unknown room — surface as a no-op rather than throwing inside React.
      return { unsubscribe: () => {} }
    }
    if (presence && !channelName.startsWith('presence-')) {
      return { unsubscribe: () => {} }
    }

    let entry = this.rooms.get(roomKey)
    if (!entry) {
      const channel = this.pusher.subscribe(channelName)
      entry = {
        channel,
        refCount: 0,
        handlers: new Set(),
      }
      // Single catch-all listener — fans out to every registered handler.
      // Filter Pusher internal events (`pusher:subscription_succeeded`,
      // `pusher:pong`, `pusher:cache_miss`, etc.) so consumers only see real
      // domain events. Presence built-ins (`pusher:member_added` /
      // `pusher:member_removed`) are bound explicitly above and routed through
      // the presence handlers, not the global fan-out.
      const globalListener = (event: string, payload: unknown) => {
        if (event.startsWith('pusher:')) {
          if (event === 'pusher:subscription_succeeded' || event === 'pusher:subscription_error') {
            console.log('[realtime.sub]', roomKey, event)
          }
          // Fan out subscribe-success to consumers so they can catch up on any
          // events published during the subscribe/reconnect window. Fires again
          // on every resubscribe (Pusher refires this on reconnect).
          if (event === 'pusher:subscription_succeeded') {
            const current = this.rooms.get(roomKey)
            if (current) {
              for (const h of current.handlers) h.onSubscribed?.()
            }
          }
          return
        }
        console.log('[realtime.sub]', roomKey, event, payload)
        const current = this.rooms.get(roomKey)
        if (!current) return
        for (const h of current.handlers) {
          h.onEvent?.(event, payload)
        }
      }
      channel.bind_global(globalListener)
      entry.globalListener = globalListener

      if (presence) {
        const presenceCh = channel as Pusher.PresenceChannel
        const onSubSucceeded = () => {
          const members: PresenceMember[] = []
          presenceCh.members.each((m: { id: string; info?: Record<string, unknown> }) => {
            members.push({ id: m.id, meta: m.info })
          })
          const current = this.rooms.get(roomKey)
          if (!current) return
          for (const h of current.handlers) {
            ;(h as PresenceHandlers).onMembers?.(members)
          }
        }
        const onMemberAdded = (member: { id: string; info?: Record<string, unknown> }) => {
          const current = this.rooms.get(roomKey)
          if (!current) return
          for (const h of current.handlers) {
            ;(h as PresenceHandlers).onJoin?.({ id: member.id, meta: member.info })
          }
        }
        const onMemberRemoved = (member: { id: string }) => {
          const current = this.rooms.get(roomKey)
          if (!current) return
          for (const h of current.handlers) {
            ;(h as PresenceHandlers).onLeave?.(member.id)
          }
        }
        const onMemberUpdate = (payload: { id: string; meta?: Record<string, unknown> }) => {
          const current = this.rooms.get(roomKey)
          if (!current) return
          for (const h of current.handlers) {
            ;(h as PresenceHandlers).onMemberUpdate?.(payload)
          }
        }
        channel.bind('pusher:subscription_succeeded', onSubSucceeded)
        channel.bind('pusher:member_added', onMemberAdded)
        channel.bind('pusher:member_removed', onMemberRemoved)
        // `member-update` is a custom server-mediated event (see
        // `RealtimeService.publishMemberUpdate`). Routed through the same
        // handler shape as Pusher's built-in member events.
        channel.bind('member-update', onMemberUpdate)
        entry.presenceListeners = {
          onSubscriptionSucceeded: onSubSucceeded,
          onMemberAdded,
          onMemberRemoved,
          onMemberUpdate,
        }
      }

      this.rooms.set(roomKey, entry)
    }

    entry.handlers.add(handlers)
    entry.refCount += 1
    if (entry.refCount === 1) {
      this.refreshRoomsSnapshot()
      this.notifyRooms()
    }

    // Late-join replay: if the channel already completed its handshake before
    // this handler attached, `pusher:subscription_succeeded` won't fire again
    // for it — so replay `onSubscribed` once, async, to match the natural
    // ordering of a fresh subscription.
    if (!presence && (entry.channel as Pusher.Channel).subscribed) {
      const h = handlers as SubscribeHandlers
      queueMicrotask(() => {
        if (this.rooms.get(roomKey)?.handlers.has(handlers)) h.onSubscribed?.()
      })
    }

    // Late-join replay: if the channel is already past `subscription_succeeded`
    // by the time a second handler attaches, the built-in event won't fire
    // again — so the new handler would never see the current roster. Replay
    // the snapshot immediately. Run async so the caller's `subscribePresence`
    // returns before `onMembers` lands (matches the natural ordering of a
    // fresh subscription).
    if (presence) {
      const presenceCh = entry.channel as Pusher.PresenceChannel
      if (presenceCh.subscribed) {
        const members: PresenceMember[] = []
        presenceCh.members.each((m: { id: string; info?: Record<string, unknown> }) => {
          members.push({ id: m.id, meta: m.info })
        })
        queueMicrotask(() => {
          if (!this.rooms.get(roomKey)?.handlers.has(handlers)) return
          ;(handlers as PresenceHandlers).onMembers?.(members)
        })
      }
    }

    return {
      unsubscribe: () => this.unsubscribe(roomKey, handlers),
    }
  }

  private unsubscribe(roomKey: string, handlers: SubscribeHandlers | PresenceHandlers) {
    const entry = this.rooms.get(roomKey)
    if (!entry) return
    entry.handlers.delete(handlers)
    entry.refCount = Math.max(0, entry.refCount - 1)
    if (entry.refCount === 0) {
      this.teardownRoom(roomKey, entry)
      this.refreshRoomsSnapshot()
      this.notifyRooms()
    }
  }

  private teardownRoom(roomKey: string, entry: RoomEntry) {
    if (!this.pusher) {
      this.rooms.delete(roomKey)
      return
    }
    const channelName = toPusherChannel(roomKey)
    try {
      if (entry.globalListener) entry.channel.unbind_global(entry.globalListener)
      if (entry.presenceListeners) {
        const l = entry.presenceListeners
        if (l.onSubscriptionSucceeded)
          entry.channel.unbind('pusher:subscription_succeeded', l.onSubscriptionSucceeded)
        if (l.onMemberAdded) entry.channel.unbind('pusher:member_added', l.onMemberAdded)
        if (l.onMemberRemoved) entry.channel.unbind('pusher:member_removed', l.onMemberRemoved)
        if (l.onMemberUpdate) entry.channel.unbind('member-update', l.onMemberUpdate)
      }
    } catch {
      /* defensive — Pusher channels may already be torn down on disconnect */
    }
    if (channelName) {
      this.pusher.unsubscribe(channelName)
    }
    this.rooms.delete(roomKey)
  }

  unsubscribeMatching(predicate: (roomKey: string) => boolean) {
    const toRemove: string[] = []
    for (const key of this.rooms.keys()) {
      if (predicate(key)) toRemove.push(key)
    }
    if (toRemove.length === 0) return
    for (const key of toRemove) {
      const entry = this.rooms.get(key)
      if (entry) this.teardownRoom(key, entry)
    }
    this.refreshRoomsSnapshot()
    this.notifyRooms()
  }

  // ----------------------------------------------------------------------
  // updateSelf — server-mediated presence meta update
  // ----------------------------------------------------------------------

  updateSelf = async (roomKey: string, meta: Record<string, unknown>): Promise<void> => {
    // Posted to the colocated tRPC `realtime.updateSelf` mutation. Routed
    // through plain fetch to keep the adapter free of tRPC-client deps.
    const trpcEndpoint = '/api/trpc/realtime.updateSelf'
    try {
      await fetch(trpcEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ json: { roomKey, meta } }),
      })
    } catch {
      /* ignore — fire-and-forget; idle transitions will retry next flip */
    }
  }

  // ----------------------------------------------------------------------
  // useSyncExternalStore plumbing
  // ----------------------------------------------------------------------

  subscribeToConnection = (callback: () => void): (() => void) => {
    this.connectionListeners.add(callback)
    return () => this.connectionListeners.delete(callback)
  }

  getConnectionSnapshot = (): boolean => this.connected
  getServerConnectionSnapshot = (): boolean => false

  subscribeToRooms = (callback: () => void): (() => void) => {
    this.roomListeners.add(callback)
    return () => this.roomListeners.delete(callback)
  }

  getRoomSnapshot = (roomKey: string): boolean => this.rooms.has(roomKey)
  getServerRoomSnapshot = (_roomKey: string): boolean => false

  getRoomMapSnapshot = (): ReadonlySet<string> => this.roomsSnapshot
  getServerRoomMapSnapshot = (): ReadonlySet<string> => FRESH_ROOM_MAP

  // ----------------------------------------------------------------------
  // Internals
  // ----------------------------------------------------------------------

  private refreshRoomsSnapshot() {
    this.roomsSnapshot = new Set(this.rooms.keys())
  }

  private notifyConnection() {
    for (const cb of this.connectionListeners) cb()
  }

  private notifyRooms() {
    for (const cb of this.roomListeners) cb()
  }
}
