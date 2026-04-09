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
}
