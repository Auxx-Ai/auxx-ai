// @auxx/lib/realtime/client/adapters/pusher.ts

import Pusher from 'pusher-js'
import type { ChannelSubscription, RealtimeAdapter } from '../types'

/** Wrap a Pusher.Channel to satisfy the ChannelSubscription interface. */
function wrapPusherChannel(channel: Pusher.Channel): ChannelSubscription {
  return {
    bind: (event, cb) => channel.bind(event, cb),
    unbind: (event, cb) => channel.unbind(event, cb),
    unbindAll: () => channel.unbind_all(),
  }
}

/**
 * Client-side Pusher implementation of RealtimeAdapter.
 * Subscribe/getSnapshot methods are arrow-function class fields for stable references
 * (required by useSyncExternalStore to avoid infinite re-render loops).
 */
export class PusherRealtimeAdapter implements RealtimeAdapter {
  private pusher: Pusher | null = null
  private connected = false
  private orgChannel: ChannelSubscription | null = null
  private currentOrgId: string | null = null
  private connectionListeners = new Set<() => void>()
  private orgChannelListeners = new Set<() => void>()

  connect(config: { key: string; cluster: string; authEndpoint: string }) {
    if (this.pusher) return // Already connected
    this.pusher = new Pusher(config.key, {
      cluster: config.cluster,
      authEndpoint: config.authEndpoint,
      forceTLS: true,
    })
    this.pusher.connection.bind('connected', () => {
      this.connected = true
      this.notifyConnectionListeners()
    })
    this.pusher.connection.bind('disconnected', () => {
      this.connected = false
      this.notifyConnectionListeners()
    })
  }

  disconnect() {
    if (this.pusher) {
      this.pusher.disconnect()
      this.pusher = null
      this.connected = false
      this.orgChannel = null
      this.currentOrgId = null
      this.notifyConnectionListeners()
      this.notifyOrgChannelListeners()
    }
  }

  subscribeToOrg(organizationId: string) {
    if (!this.pusher) return
    // Skip if already subscribed to this org
    if (this.currentOrgId === organizationId && this.orgChannel) return

    // Unsubscribe from previous org channel
    if (this.currentOrgId) {
      this.pusher.unsubscribe(`presence-org-${this.currentOrgId}`)
    }

    const channel = this.pusher.subscribe(`presence-org-${organizationId}`)
    this.orgChannel = wrapPusherChannel(channel)
    this.currentOrgId = organizationId
    this.notifyOrgChannelListeners()
  }

  getSocketId(): string | undefined {
    return this.pusher?.connection?.socket_id
  }

  isConnected(): boolean {
    return this.connected
  }

  // --- useSyncExternalStore contract (stable arrow-function references) ---

  subscribeToConnection = (callback: () => void): (() => void) => {
    this.connectionListeners.add(callback)
    return () => this.connectionListeners.delete(callback)
  }

  getConnectionSnapshot = (): boolean => this.connected

  getServerConnectionSnapshot = (): boolean => false

  subscribeToOrgChannel = (callback: () => void): (() => void) => {
    this.orgChannelListeners.add(callback)
    return () => this.orgChannelListeners.delete(callback)
  }

  getOrgChannelSnapshot = (): ChannelSubscription | null => this.orgChannel

  getServerOrgChannelSnapshot = (): ChannelSubscription | null => null

  // --- Internal ---

  private notifyConnectionListeners() {
    for (const cb of this.connectionListeners) cb()
  }

  private notifyOrgChannelListeners() {
    for (const cb of this.orgChannelListeners) cb()
  }
}
