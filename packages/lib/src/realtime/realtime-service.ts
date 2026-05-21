// @auxx/lib/realtime/realtime-service.ts

import type { RealtimeProvider } from './types'

/**
 * Provider-agnostic realtime service.
 * Wraps a RealtimeProvider with channel naming conventions and convenience methods.
 */
export class RealtimeService {
  private provider: RealtimeProvider

  constructor(provider: RealtimeProvider) {
    this.provider = provider
  }

  /** Publish to `presence-org-{organizationId}` */
  async sendToOrganization(
    organizationId: string,
    event: string,
    data: unknown,
    options?: { excludeSocketId?: string }
  ): Promise<boolean> {
    return this.provider.publish(`presence-org-${organizationId}`, event, data, options)
  }

  /**
   * Publish to `presence-org-{organizationId}-inbox-{inboxId | 'none'}`.
   * Mail events publish per-inbox so users only receive events for inboxes they
   * can read. Unassigned threads (`inboxId = null`) ride on the `none` slug,
   * which every org member subscribes to as the org-triage default.
   */
  async sendToInbox(
    organizationId: string,
    inboxId: string | null,
    event: string,
    data: unknown,
    options?: { excludeSocketId?: string }
  ): Promise<boolean> {
    const slug = inboxId ?? 'none'
    return this.provider.publish(
      `presence-org-${organizationId}-inbox-${slug}`,
      event,
      data,
      options
    )
  }

  /** Publish to `private-user-{userId}` */
  async sendToUser(
    userId: string,
    event: string,
    data: unknown,
    options?: { excludeSocketId?: string }
  ): Promise<boolean> {
    return this.provider.publish(`private-user-${userId}`, event, data, options)
  }

  /** Publish to `private-chat-{sessionId}` */
  async sendToChat(
    sessionId: string,
    event: string,
    data: unknown,
    options?: { excludeSocketId?: string }
  ): Promise<boolean> {
    return this.provider.publish(`private-chat-${sessionId}`, event, data, options)
  }

  /**
   * Publish to `private-visitor-{visitorParticipantId}` — the cross-thread
   * channel used by the chat widget to receive updates for any of the visitor's
   * threads (Messages tab list + launcher unread badge).
   */
  async sendToVisitor(
    visitorParticipantId: string,
    event: string,
    data: unknown,
    options?: { excludeSocketId?: string }
  ): Promise<boolean> {
    return this.provider.publish(`private-visitor-${visitorParticipantId}`, event, data, options)
  }

  /** Authenticate a client for a private/presence channel */
  authenticateChannel(
    socketId: string,
    channel: string,
    userData?: { id: string; name?: string; email?: string; image?: string }
  ) {
    return this.provider.authenticate(socketId, channel, userData)
  }
}
