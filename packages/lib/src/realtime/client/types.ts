// @auxx/lib/realtime/client/types.ts

/** A live subscription. Call `unsubscribe()` to release a single ref. */
export interface Subscription {
  unsubscribe(): void
}

/** Member info delivered on presence rooms. */
export interface PresenceMember {
  id: string
  meta?: Record<string, unknown>
}

/** Event-only handlers (plain rooms). */
export interface SubscribeHandlers {
  onEvent?(event: string, payload: unknown): void
  /**
   * Fired once the channel completes its `pusher:subscription_succeeded`
   * handshake — and again on every resubscribe (e.g. after a reconnect). Use
   * it to catch up on anything published while the channel was not yet bound:
   * Pusher does not replay events sent during the subscribe/reconnect window.
   */
  onSubscribed?(): void
}

/** Presence-room handlers — extend plain handlers with member tracking. */
export interface PresenceHandlers extends SubscribeHandlers {
  /** Snapshot fired once after `pusher:subscription_succeeded`. */
  onMembers?(members: PresenceMember[]): void
  onJoin?(member: PresenceMember): void
  onLeave?(memberId: string): void
  onMemberUpdate?(member: PresenceMember): void
}

/**
 * Provider-agnostic client-side realtime adapter.
 *
 * Designed for `useSyncExternalStore` — every `subscribeToX` / `getXSnapshot`
 * is an arrow-function class field so React gets stable references and avoids
 * infinite re-render loops.
 *
 * The adapter is refcounted internally — multiple components can subscribe to
 * the same room and only the last `unsubscribe()` tears down the underlying
 * Pusher channel.
 */
export interface RealtimeAdapter {
  // Lifecycle
  connect(config: { key: string; cluster: string; authEndpoint: string }): void
  disconnect(): void
  getSocketId(): string | undefined
  isConnected(): boolean

  /** Subscribe to a plain (private-) room. Refcounted per `roomKey`. */
  subscribe(roomKey: string, handlers: SubscribeHandlers): Subscription
  /** Subscribe to a presence room. Refcounted per `roomKey`. */
  subscribePresence(roomKey: string, self: PresenceMember, handlers: PresenceHandlers): Subscription
  /**
   * Server-mediated meta update. Posts to the `realtime.updateSelf` tRPC; the
   * server publishes a `member-update` event on the room via Pusher REST.
   * No Pusher client-events are emitted.
   */
  updateSelf(roomKey: string, meta: Record<string, unknown>): Promise<void>

  // useSyncExternalStore — connection state
  subscribeToConnection(callback: () => void): () => void
  getConnectionSnapshot(): boolean
  getServerConnectionSnapshot(): boolean

  // useSyncExternalStore — per-room subscription tracking. Listeners fire
  // whenever any subscription is added or removed. Snapshots are stable
  // references until membership changes.
  subscribeToRooms(callback: () => void): () => void
  getRoomSnapshot(roomKey: string): boolean
  getServerRoomSnapshot(roomKey: string): boolean
  /** Snapshot of all currently-subscribed room keys (stable until membership changes). */
  getRoomMapSnapshot(): ReadonlySet<string>
  getServerRoomMapSnapshot(): ReadonlySet<string>

  /**
   * Drop every subscription tied to a roomKey prefix. Used by the lifecycle
   * hook to tear down org-scoped rooms when the active org switches.
   */
  unsubscribeMatching(predicate: (roomKey: string) => boolean): void
}
