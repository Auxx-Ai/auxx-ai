// @auxx/lib/realtime/client/types.ts

/** A channel subscription that supports event binding/unbinding. */
export interface ChannelSubscription {
  bind(event: string, callback: (data: unknown) => void): void
  unbind(event: string, callback?: (data: unknown) => void): void
  unbindAll(): void
}

/**
 * Provider-agnostic client-side realtime adapter.
 * Manages connection lifecycle, org channel, and useSyncExternalStore-compatible subscriptions.
 */
export interface RealtimeAdapter {
  // Lifecycle
  connect(config: { key: string; cluster: string; authEndpoint: string }): void
  disconnect(): void

  // Channel management
  subscribeToOrg(organizationId: string): void

  /**
   * Subscribe to a per-inbox channel. `inboxSlug` is the raw inbox UUID, or
   * the literal string `'none'` for the unassigned-triage channel. Idempotent
   * — multiple subscriptions to the same slug return the same channel.
   */
  subscribeToInbox(organizationId: string, inboxSlug: string): void

  /** Unsubscribe from a per-inbox channel. */
  unsubscribeFromInbox(organizationId: string, inboxSlug: string): void

  // State reads (non-reactive, for imperative access)
  getSocketId(): string | undefined
  isConnected(): boolean

  // useSyncExternalStore-compatible subscriptions for connection state
  subscribeToConnection(callback: () => void): () => void
  getConnectionSnapshot(): boolean
  getServerConnectionSnapshot(): boolean

  // useSyncExternalStore-compatible subscriptions for org channel
  subscribeToOrgChannel(callback: () => void): () => void
  getOrgChannelSnapshot(): ChannelSubscription | null
  getServerOrgChannelSnapshot(): ChannelSubscription | null

  // useSyncExternalStore-compatible subscriptions for inbox channels.
  // Listeners are notified whenever any inbox channel is added or removed.
  // The map snapshot is stable until membership changes (referentially equal).
  subscribeToInboxChannels(callback: () => void): () => void
  getInboxChannelSnapshot(inboxSlug: string): ChannelSubscription | null
  getServerInboxChannelSnapshot(inboxSlug: string): ChannelSubscription | null
  /** Stable map snapshot — same reference until membership changes. */
  getInboxChannelMapSnapshot(): ReadonlyMap<string, ChannelSubscription>
  getServerInboxChannelMapSnapshot(): ReadonlyMap<string, ChannelSubscription>
}
