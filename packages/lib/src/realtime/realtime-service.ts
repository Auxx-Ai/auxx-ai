// @auxx/lib/realtime/realtime-service.ts

import { type AuthorizeCtx, findRoom, fromPusherChannel, toPusherChannel } from './rooms'
import type { RealtimeProvider } from './types'

/**
 * Provider-agnostic realtime service.
 *
 * The public API is opaque-room-key based — callers build keys via
 * `rooms.X(...)` helpers and the service handles the Pusher prefix mapping
 * (`presence-` / `private-`) internally.
 */
export class RealtimeService {
  private provider: RealtimeProvider

  constructor(provider: RealtimeProvider) {
    this.provider = provider
  }

  /**
   * Publish an event to a room. The Pusher channel name is derived from the
   * room's registered kind (plain → `private-{key}`, presence → `presence-{key}`).
   * Returns false if the room isn't registered or the provider isn't initialized.
   */
  async publish(
    roomKey: string,
    event: string,
    data: unknown,
    options?: { excludeSocketId?: string }
  ): Promise<boolean> {
    const channel = toPusherChannel(roomKey)
    if (!channel) return false
    return this.provider.publish(channel, event, data, options)
  }

  /**
   * Publish a `member-update` event on a presence room. Used by
   * `realtime.updateSelf` tRPC to fan out per-member meta changes (e.g. idle
   * transitions, custom status) without relying on Pusher client-events.
   */
  async publishMemberUpdate(
    roomKey: string,
    member: { id: string; meta?: Record<string, unknown> }
  ): Promise<boolean> {
    const def = findRoom(roomKey)
    if (!def || def.kind !== 'presence') return false
    return this.publish(roomKey, 'member-update', member)
  }

  /**
   * Authenticate a Pusher channel binding. Takes the raw Pusher channel name
   * (e.g. `private-org-xxx-inbox-yyy`) so the route handler can pass through
   * what Pusher sent it. ACL is dispatched via the room registry.
   */
  async authorize(
    socketId: string,
    channelName: string,
    ctx: AuthorizeCtx,
    userData?: { id: string; name?: string; email?: string; image?: string }
  ): Promise<{ auth: string; channel_data?: string } | null> {
    const roomKey = fromPusherChannel(channelName)
    if (!roomKey) return null
    const def = findRoom(roomKey)
    if (!def) return null
    // Reject if the channel prefix doesn't match the registered kind.
    const expected = toPusherChannel(roomKey)
    if (expected !== channelName) return null

    const allowed = await def.authorize(roomKey, ctx)
    if (!allowed) return null
    return this.provider.authenticate(socketId, channelName, userData)
  }

  /**
   * Raw Pusher authentication — used by the widget auth route which does its
   * own visitor-passport check upstream. Prefer `authorize(...)` everywhere
   * else.
   */
  authenticateChannel(
    socketId: string,
    channel: string,
    userData?: { id: string; name?: string; email?: string; image?: string }
  ) {
    return this.provider.authenticate(socketId, channel, userData)
  }
}
