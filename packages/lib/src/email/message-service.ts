// packages/lib/src/email/message-service-refactored.ts

import { createScopedLogger } from '@auxx/logger'
import { MessageSenderService } from '../messages/message-sender.service'
import { MessageSyncService } from '../messages/message-sync-service'
import type { ParticipantInput } from '../messages/types/message-sending.types'
import type { ChannelProvider, SendMessageOptions } from '../providers/channel-provider.interface'
import { ProviderRegistryService } from '../providers/provider-registry-service'
import { WebhookManagerService } from '../providers/webhook-manager-service'

const logger = createScopedLogger('message-service')

// Import centralized provider types
import { ChannelProviderType, MessageType } from '../providers/types'

// Re-export for backward compatibility
export { ChannelProviderType, MessageType }

/** Email addresses -> the participant shape MessageSenderService expects. */
function toParticipants(addresses: string | string[]): ParticipantInput[] {
  return (Array.isArray(addresses) ? addresses : [addresses]).map((identifier) => ({
    identifier,
    identifierType: 'EMAIL' as const,
  }))
}

export interface ActiveIntegration {
  type: ChannelProviderType
  id: string
  details: { identifier?: string; provider: string }
  /** Raw `Integration.metadata` jsonb — shape varies per provider. */
  metadata?: Record<string, unknown> | null
}

export interface ProviderInstance {
  provider: ChannelProvider
  type: ChannelProviderType
  integrationId: string
  details: { identifier?: string; provider: string }
  /** Raw `Integration.metadata` jsonb — shape varies per provider. */
  metadata?: Record<string, unknown> | null
}

/**
 * MessageService - High-level orchestrator for message operations
 *
 * This refactored version delegates to specialized services:
 * - ProviderRegistryService for provider management
 * - MessageSenderService for message sending
 * - WebhookManagerService for webhook operations
 * - MessageSyncService for synchronization
 *
 * Acts as a facade to maintain backward compatibility while providing
 * a clean interface for message operations.
 */
export class MessageService {
  private organizationId: string
  private providerRegistry: ProviderRegistryService
  private messageSender: MessageSenderService
  private webhookManager: WebhookManagerService
  private messageSync: MessageSyncService

  constructor(organizationId: string) {
    this.organizationId = organizationId

    // Initialize specialized services
    this.providerRegistry = new ProviderRegistryService(organizationId)
    this.messageSender = new MessageSenderService(organizationId, this.providerRegistry)
    this.webhookManager = new WebhookManagerService(organizationId, this.providerRegistry)
    this.messageSync = new MessageSyncService(organizationId, this.providerRegistry)
  }

  // Static Methods - delegate to specialized services

  static async getAllIntegrations(organizationId: string): Promise<ActiveIntegration[]> {
    const providerRegistry = new ProviderRegistryService(organizationId)
    return providerRegistry.getAllIntegrations()
  }

  static async registerWebhooks(
    organizationId: string,
    integrationType: ChannelProviderType,
    integrationId?: string
  ): Promise<void> {
    const webhookManager = new WebhookManagerService(
      organizationId,
      new ProviderRegistryService(organizationId)
    )
    return webhookManager.setupWebhooks(integrationType, integrationId)
  }

  static async unregisterWebhooks(
    organizationId: string,
    integrationType: ChannelProviderType,
    integrationId?: string
  ): Promise<void> {
    const webhookManager = new WebhookManagerService(
      organizationId,
      new ProviderRegistryService(organizationId)
    )
    return webhookManager.removeWebhooks(integrationType, integrationId)
  }

  // Instance Methods - delegate to injected services

  async initializeAll(): Promise<void> {
    return this.providerRegistry.initializeAll()
  }

  async getProvider(type: ChannelProviderType, integrationId: string): Promise<ChannelProvider> {
    return this.providerRegistry.getProvider(integrationId)
  }

  async sendMessage(
    options: SendMessageOptions & {
      /** Sending user — required by MessageSenderService for attribution. */
      userId: string
      integrationId: string
      /** Internal thread to reply on. Omit to start a new thread. */
      threadId?: string
    }
  ): Promise<{ id?: string; success: boolean; threadId?: string }> {
    const sendResult = await this.messageSender.sendMessage({
      userId: options.userId,
      organizationId: this.organizationId,
      integrationId: options.integrationId,
      threadId: options.threadId,
      messageId: options.messageId,
      subject: options.subject ?? '',
      textHtml: options.html,
      textPlain: options.text,
      to: toParticipants(options.to),
      cc: options.cc ? toParticipants(options.cc) : undefined,
      bcc: options.bcc ? toParticipants(options.bcc) : undefined,
      attachmentIds: options.attachmentIds,
    })

    return {
      id: sendResult.id,
      success: sendResult.sendStatus === 'SENT',
      threadId: sendResult.threadId,
    }
  }

  async setupWebhook(
    type: ChannelProviderType,
    integrationId: string,
    callbackUrl: string
  ): Promise<void> {
    return this.webhookManager.setupWebhook(type, integrationId, callbackUrl)
  }

  async removeWebhook(type: ChannelProviderType, integrationId: string): Promise<void> {
    return this.webhookManager.removeWebhook(type, integrationId)
  }

  async syncMessages(
    type: ChannelProviderType,
    integrationId: string,
    since?: Date
  ): Promise<void> {
    return this.messageSync.syncMessages(type, integrationId, since)
  }

  async syncAllMessages(since?: Date): Promise<void> {
    return this.messageSync.syncAllMessages(since)
  }

  getMessageSender(): MessageSenderService {
    return this.messageSender
  }

  getWebhookManager(): WebhookManagerService {
    return this.webhookManager
  }

  getMessageSync(): MessageSyncService {
    return this.messageSync
  }
}
