// packages/lib/src/email/message-service-refactored.ts
import {
  type IntegrationProvider,
  type SendMessageOptions,
} from '../providers/integration-provider.interface'
import { createScopedLogger } from '@auxx/logger'
import { ProviderRegistryService } from '../providers/provider-registry-service'
import { MessageSenderService } from '../messages/message-sender.service'
import { WebhookManagerService } from '../providers/webhook-manager-service'
import { MessageSyncService } from '../messages/message-sync-service'

const logger = createScopedLogger('message-service')

// Import centralized provider types
import { IntegrationProviderType, MessageType } from '../providers/types'

// Re-export for backward compatibility
export { IntegrationProviderType, MessageType }

export interface ActiveIntegration {
  type: IntegrationProviderType
  id: string
  details: { identifier?: string; provider: string }
  metadata?: { email?: string; phoneNumber?: string; pageId?: string } | null
}

export interface ProviderInstance {
  provider: IntegrationProvider
  type: IntegrationProviderType
  integrationId: string
  details: { identifier?: string; provider: string }
  metadata?: { email?: string; phoneNumber?: string; pageId?: string } | null
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
    integrationType: IntegrationProviderType,
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
    integrationType: IntegrationProviderType,
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

  async getProvider(
    type: IntegrationProviderType,
    integrationId: string
  ): Promise<IntegrationProvider> {
    return this.providerRegistry.getProvider(integrationId)
  }

  async sendMessage(
    options: SendMessageOptions & {
      providerType?: IntegrationProviderType
      integrationId?: string
    }
  ): Promise<{ id?: string; success: boolean; threadId?: string }> {
    // Determine provider and delegate to MessageSenderService
    const sendResult = await this.messageSender.sendMessage({
      to: Array.isArray(options.to) ? options.to : [options.to],
      from: options.from || '',
      subject: options.subject,
      textHtml: options.html,
      textPlain: options.text,
      references: options.references,
      inReplyTo: options.inReplyTo,
      externalThreadId: options.externalThreadId,
      providerType: options.providerType || 'google',
      integrationId: options.integrationId || '',
    })

    return {
      id: sendResult.id,
      success: sendResult.success,
      threadId: (sendResult as any).threadId,
    }
  }

  async setupWebhook(
    type: IntegrationProviderType,
    integrationId: string,
    callbackUrl: string
  ): Promise<void> {
    return this.webhookManager.setupWebhook(type, integrationId, callbackUrl)
  }

  async removeWebhook(type: IntegrationProviderType, integrationId: string): Promise<void> {
    return this.webhookManager.removeWebhook(type, integrationId)
  }

  async syncMessages(
    type: IntegrationProviderType,
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
