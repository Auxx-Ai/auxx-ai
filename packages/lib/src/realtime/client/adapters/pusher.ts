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

  /** slug → channel wrapper; slug is the raw inbox UUID or `'none'`. */
  private inboxChannels: Map<string, ChannelSubscription> = new Map()
  /** Frozen snapshot — replaced (new reference) only on membership change. */
  private inboxChannelsSnapshot: ReadonlyMap<string, ChannelSubscription> = new Map()
  /** Reference count per slug so multiple consumers can subscribe safely. */
  private inboxRefCounts = new Map<string, number>()
  private inboxChannelListeners = new Set<() => void>()
  private static readonly EMPTY_INBOX_MAP: ReadonlyMap<string, ChannelSubscription> = new Map()

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
      this.inboxChannels.clear()
      this.inboxRefCounts.clear()
      this.refreshInboxSnapshot()
      this.notifyConnectionListeners()
      this.notifyOrgChannelListeners()
      this.notifyInboxChannelListeners()
    }
  }

  subscribeToOrg(organizationId: string) {
    if (!this.pusher) return
    // Skip if already subscribed to this org
    if (this.currentOrgId === organizationId && this.orgChannel) return

    // Unsubscribe from previous org channel
    if (this.currentOrgId) {
      this.pusher.unsubscribe(`presence-org-${this.currentOrgId}`)
      // Drop any stale per-inbox subscriptions tied to the previous org.
      for (const slug of this.inboxChannels.keys()) {
        this.pusher.unsubscribe(`presence-org-${this.currentOrgId}-inbox-${slug}`)
      }
      this.inboxChannels.clear()
      this.inboxRefCounts.clear()
      this.refreshInboxSnapshot()
      this.notifyInboxChannelListeners()
    }

    const channel = this.pusher.subscribe(`presence-org-${organizationId}`)
    this.orgChannel = wrapPusherChannel(channel)
    this.currentOrgId = organizationId
    this.notifyOrgChannelListeners()
  }

  subscribeToInbox(organizationId: string, inboxSlug: string) {
    if (!this.pusher) return
    if (this.currentOrgId !== organizationId) return

    const refCount = (this.inboxRefCounts.get(inboxSlug) ?? 0) + 1
    this.inboxRefCounts.set(inboxSlug, refCount)
    if (this.inboxChannels.has(inboxSlug)) return

    const channelName = `presence-org-${organizationId}-inbox-${inboxSlug}`
    const channel = this.pusher.subscribe(channelName)
    this.inboxChannels.set(inboxSlug, wrapPusherChannel(channel))
    this.refreshInboxSnapshot()
    this.notifyInboxChannelListeners()
  }

  unsubscribeFromInbox(organizationId: string, inboxSlug: string) {
    if (!this.pusher) return
    if (this.currentOrgId !== organizationId) return

    const refCount = this.inboxRefCounts.get(inboxSlug) ?? 0
    if (refCount <= 1) {
      this.inboxRefCounts.delete(inboxSlug)
      this.inboxChannels.delete(inboxSlug)
      this.pusher.unsubscribe(`presence-org-${organizationId}-inbox-${inboxSlug}`)
      this.refreshInboxSnapshot()
      this.notifyInboxChannelListeners()
    } else {
      this.inboxRefCounts.set(inboxSlug, refCount - 1)
    }
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

  subscribeToInboxChannels = (callback: () => void): (() => void) => {
    this.inboxChannelListeners.add(callback)
    return () => this.inboxChannelListeners.delete(callback)
  }

  getInboxChannelSnapshot = (inboxSlug: string): ChannelSubscription | null =>
    this.inboxChannels.get(inboxSlug) ?? null

  getServerInboxChannelSnapshot = (_inboxSlug: string): ChannelSubscription | null => null

  getInboxChannelMapSnapshot = (): ReadonlyMap<string, ChannelSubscription> =>
    this.inboxChannelsSnapshot

  getServerInboxChannelMapSnapshot = (): ReadonlyMap<string, ChannelSubscription> =>
    PusherRealtimeAdapter.EMPTY_INBOX_MAP

  // --- Internal ---

  /** Replace the public snapshot with a frozen copy of the live map. */
  private refreshInboxSnapshot() {
    this.inboxChannelsSnapshot = new Map(this.inboxChannels)
  }

  private notifyConnectionListeners() {
    for (const cb of this.connectionListeners) cb()
  }

  private notifyOrgChannelListeners() {
    for (const cb of this.orgChannelListeners) cb()
  }

  private notifyInboxChannelListeners() {
    for (const cb of this.inboxChannelListeners) cb()
  }
}
