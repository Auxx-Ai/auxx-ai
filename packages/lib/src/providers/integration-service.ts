// packages/lib/src/providers/integration-service.ts
import { type Database, schema } from '@auxx/database'
import { and, count, desc, eq, inArray, isNotNull } from 'drizzle-orm'
import { withAuthErrorHandling } from '../email/errors-handlers'
import { type IntegrationProviderType, MessageService } from '../email/message-service'
import { createScopedLogger } from '../logger'
import { SyncMessages } from '../messages/sync-messages'
import { FacebookOAuthService } from './facebook/facebook-oauth'
import { GoogleOAuthService } from './google/google-oauth'
import { InstagramOAuthService } from './instagram/instagram-oauth'
import { OpenPhoneService } from './openphone/openphone-service'
import { OutlookOAuthService } from './outlook/outlook-oauth'
import { getEmailProviders, whereThreadMessageType } from './query-helpers'

const logger = createScopedLogger('integration-service')

/**
 * Interface for integration settings
 */
interface IntegrationSettings {
  recordCreation?: {
    mode: 'all' | 'selective' | 'none'
  }
  // Add other settings categories as needed
}

/**
 * Interface for OpenPhone integration input
 */
interface OpenPhoneInput {
  apiKey: string
  phoneNumberId: string
  phoneNumber: string
  webhookSigningSecret: string
}

/**
 * Custom error class for integration-related errors
 */
class IntegrationError extends Error {
  constructor(
    message: string,
    public code: string,
    public cause?: unknown
  ) {
    super(message)
    this.name = 'IntegrationError'
  }
}

/**
 * Service for managing integrations
 */
export class IntegrationService {
  private db: Database
  private organizationId: string
  private userId?: string

  constructor(db: Database, organizationId: string, userId?: string) {
    this.db = db
    this.organizationId = organizationId
    this.userId = userId
  }

  /**
   * Helper to safely extract identifier from integration
   */
  private getIdentifier(
    integration:
      | (typeof schema.Integration.$inferSelect & {
          chatWidget?: typeof schema.ChatWidget.$inferSelect | null
        })
      | null
  ): string | undefined {
    if (!integration) return undefined
    if (integration.provider === 'chat' && integration.chatWidget) {
      return integration.chatWidget.name
    }
    // Forwarding integrations store the alias in Integration.email
    if (integration.email) return integration.email
    const metadata = integration.metadata
    if (metadata && typeof metadata === 'object') {
      if ('email' in metadata && typeof metadata.email === 'string') return metadata.email
      if ('phoneNumber' in metadata && typeof metadata.phoneNumber === 'string')
        return metadata.phoneNumber
    }
    return integration.name || undefined
  }

  /**
   * Validate that an integration belongs to the organization
   */
  private async validateIntegrationOwnership(integrationId: string) {
    const [integration] = await this.db
      .select()
      .from(schema.Integration)
      .leftJoin(schema.ChatWidget, eq(schema.ChatWidget.integrationId, schema.Integration.id))
      .where(eq(schema.Integration.id, integrationId))
      .limit(1)

    if (
      !integration?.Integration ||
      integration.Integration.organizationId !== this.organizationId
    ) {
      throw new IntegrationError('Integration not found or access denied', 'INTEGRATION_NOT_FOUND')
    }

    return {
      ...integration.Integration,
      chatWidget: integration.ChatWidget,
    }
  }

  /**
   * Delete threads and messages associated with an integration
   */
  private async deleteIntegrationData(tx: typeof this.db, integrationId: string, provider: string) {
    logger.warn(`Deleting data for integration: ${integrationId} (${provider})`)

    if (provider === 'chat') {
      const deletedChatThreads = await tx
        .delete(schema.Thread)
        .where(and(eq(schema.Thread.integrationId, integrationId), whereThreadMessageType('CHAT')))
      logger.info(`Deleted CHAT threads for integration ${integrationId}`)
    } else {
      const deletedMessages = await tx
        .delete(schema.Message)
        .where(eq(schema.Message.integrationId, integrationId))
      logger.info(`Deleted messages for integration ${integrationId}`)

      const deletedThreads = await tx
        .delete(schema.Thread)
        .where(eq(schema.Thread.integrationId, integrationId))
      logger.info(`Deleted threads for integration ${integrationId}`)
    }
  }

  /**
   * Get OAuth URL for provider authentication
   */
  async getAuthUrl(provider: IntegrationProviderType, redirectPath?: string) {
    try {
      if (provider === 'chat') {
        throw new IntegrationError(
          'OAuth authentication is not applicable for chat widgets',
          'INVALID_PROVIDER'
        )
      }

      if (!this.userId) {
        throw new IntegrationError('User ID required for OAuth authentication', 'USER_ID_REQUIRED')
      }

      let authUrl: string | null = null

      switch (provider) {
        case 'google': {
          const googleOAuthService = GoogleOAuthService.getInstance()
          authUrl = googleOAuthService.getAuthUrl(this.organizationId, this.userId, {
            redirectPath,
          })
          break
        }
        case 'outlook': {
          const outlookOAuthService = OutlookOAuthService.getInstance()
          authUrl = await outlookOAuthService.getAuthUrl(this.organizationId, this.userId, {
            redirectPath,
          })
          break
        }
        case 'facebook': {
          const facebookOAuthService = FacebookOAuthService.getInstance()
          authUrl = await facebookOAuthService.getAuthUrl(this.organizationId, this.userId, {
            redirectPath,
          })
          break
        }
        case 'instagram': {
          const instagramOAuthService = InstagramOAuthService.getInstance()
          authUrl = instagramOAuthService.getAuthUrl(this.organizationId, this.userId, {
            redirectPath,
          })
          break
        }
        default:
          throw new IntegrationError(`Unsupported provider: ${provider}`, 'UNSUPPORTED_PROVIDER')
      }

      return { authUrl }
    } catch (error: any) {
      logger.error('Error generating auth URL:', {
        error: error.message,
        provider,
      })

      if (error instanceof IntegrationError) {
        throw error
      }

      throw new IntegrationError(
        `Failed to generate authorization URL for ${provider}`,
        'AUTH_URL_FAILED',
        error
      )
    }
  }

  /**
   * Get all integrations for the organization
   */
  async getAllIntegrations() {
    try {
      const integrationsData = await this.db
        .select({
          id: schema.Integration.id,
          provider: schema.Integration.provider,
          name: schema.Integration.name,
          enabled: schema.Integration.enabled,
          updatedAt: schema.Integration.updatedAt,
          lastSyncedAt: schema.Integration.lastSyncedAt,
          email: schema.Integration.email,
          metadata: schema.Integration.metadata,
          authStatus: schema.Integration.authStatus,
          lastSuccessfulSync: schema.Integration.lastSuccessfulSync,
          requiresReauth: schema.Integration.requiresReauth,
          lastAuthError: schema.Integration.lastAuthError,
          lastAuthErrorAt: schema.Integration.lastAuthErrorAt,
          syncStatus: schema.Integration.syncStatus,
          syncStage: schema.Integration.syncStage,
          syncStageStartedAt: schema.Integration.syncStageStartedAt,
          throttleFailureCount: schema.Integration.throttleFailureCount,
          throttleRetryAfter: schema.Integration.throttleRetryAfter,
          chatWidget: schema.ChatWidget,
          inboxId: schema.InboxIntegration.inboxId,
        })
        .from(schema.Integration)
        .leftJoin(schema.ChatWidget, eq(schema.ChatWidget.integrationId, schema.Integration.id))
        .leftJoin(
          schema.InboxIntegration,
          eq(schema.InboxIntegration.integrationId, schema.Integration.id)
        )
        .where(eq(schema.Integration.organizationId, this.organizationId))
        .orderBy(schema.Integration.provider, desc(schema.Integration.createdAt))

      const integrations = integrationsData

      const formattedIntegrations = integrations.map((int) => {
        return {
          id: int.id,
          provider: int.provider,
          name: int.name,
          enabled: int.enabled,
          updatedAt: int.updatedAt,
          lastSyncedAt: int.lastSyncedAt,
          email: int.email || (int.metadata as any)?.email || undefined,
          identifier: this.getIdentifier({ ...int, chatWidget: int.chatWidget }),
          inboxId: int.inboxId,
          widgetSettings: int.provider === 'chat' ? int.chatWidget : undefined,
          authStatus: int.authStatus,
          lastSuccessfulSync: int.lastSuccessfulSync,
          metadata: int.metadata,
          // Auth fields — direct columns
          requiresReauth: int.requiresReauth,
          lastAuthError: int.lastAuthError,
          lastAuthErrorAt: int.lastAuthErrorAt,
          // Sync state — direct columns
          syncStatus: int.syncStatus,
          syncStage: int.syncStage,
          syncStageStartedAt: int.syncStageStartedAt,
          // Throttling
          throttleFailureCount: int.throttleFailureCount,
          throttleRetryAfter: int.throttleRetryAfter,
          settings: ((int.metadata as any)?.settings as IntegrationSettings) || {},
        }
      })

      return { integrations: formattedIntegrations }
    } catch (error: any) {
      logger.error('Error getting integrations:', {
        error: error.message,
        organizationId: this.organizationId,
      })
      throw new IntegrationError('Failed to get integrations', 'GET_INTEGRATIONS_FAILED', error)
    }
  }

  /**
   * Get email client integrations
   */
  async getEmailClients() {
    try {
      const integrations = await this.db
        .select({
          id: schema.Integration.id,
          provider: schema.Integration.provider,
          name: schema.Integration.name,
          email: schema.Integration.email,
          metadata: schema.Integration.metadata,
          inboxId: schema.InboxIntegration.inboxId,
        })
        .from(schema.Integration)
        .leftJoin(
          schema.InboxIntegration,
          eq(schema.InboxIntegration.integrationId, schema.Integration.id)
        )
        .where(
          and(
            eq(schema.Integration.organizationId, this.organizationId),
            inArray(schema.Integration.provider, getEmailProviders())
          )
        )

      const emailClients = integrations.map((int) => {
        // Prefer Integration.email (used by forwarding integrations), fall back to metadata.email
        let email: string | undefined = int.email ?? undefined
        if (!email && int.metadata && typeof int.metadata === 'object' && 'email' in int.metadata) {
          // @ts-expect-error: dynamic metadata shape
          email = int.metadata.email
        }
        return {
          id: int.id,
          provider: int.provider,
          name: int.name,
          email,
          settings: ((int.metadata as any)?.settings as IntegrationSettings) || {},
          inboxId: int.inboxId,
        }
      })
      return emailClients
    } catch (error: any) {
      logger.error('Error getting email clients:', {
        error: error.message,
        organizationId: this.organizationId,
      })
      throw new IntegrationError('Failed to get email clients', 'GET_EMAIL_CLIENTS_FAILED', error)
    }
  }

  /**
   * Disconnect an integration
   */
  async disconnect(integrationId: string) {
    try {
      const integration = await this.validateIntegrationOwnership(integrationId)

      // Revoke external access if applicable
      let oauthService
      switch (integration.provider) {
        case 'google':
          oauthService = GoogleOAuthService.getInstance()
          break
        case 'outlook':
          oauthService = OutlookOAuthService.getInstance()
          break
        case 'facebook':
          oauthService = FacebookOAuthService.getInstance()
          break
        case 'instagram':
          oauthService = InstagramOAuthService.getInstance()
          break
      }

      if (oauthService) {
        try {
          await oauthService.revokeAccess(integrationId)
          logger.info(
            `Successfully revoked access for integration ${integrationId} via ${integration.provider} service.`
          )
        } catch (revokeError: any) {
          logger.error(
            `Failed to revoke access via ${integration.provider} service, continuing deletion:`,
            { error: revokeError.message, integrationId }
          )
        }
      }

      // Collect affected inbox IDs before deleting data (for count cleanup)
      const affectedInboxRows = await this.db
        .selectDistinct({ inboxId: schema.Thread.inboxId })
        .from(schema.Thread)
        .where(
          and(eq(schema.Thread.integrationId, integrationId), isNotNull(schema.Thread.inboxId))
        )
      const affectedInboxIds = affectedInboxRows.map((r) => r.inboxId).filter(Boolean) as string[]

      // Perform database cleanup within a transaction
      await this.db.transaction(async (tx) => {
        await this.deleteIntegrationData(tx, integrationId, integration.provider)
        await tx.delete(schema.Integration).where(eq(schema.Integration.id, integrationId))
        logger.info(
          `Successfully deleted integration record ${integrationId} (${integration.provider}) from database.`
        )
      })

      // Delete stale cached inbox counts for affected inboxes
      if (affectedInboxIds.length > 0) {
        await this.db
          .delete(schema.UserInboxUnreadCount)
          .where(inArray(schema.UserInboxUnreadCount.inboxId, affectedInboxIds))
        logger.info(
          `Deleted stale UserInboxUnreadCount rows for inboxes: ${affectedInboxIds.join(', ')}`
        )
      }

      return {
        success: true,
        message: `Integration ${integration.provider} disconnected successfully.`,
      }
    } catch (error: any) {
      if (error instanceof IntegrationError) throw error
      logger.error('Error disconnecting integration:', { error: error.message, integrationId })
      throw new IntegrationError(`Failed to disconnect integration`, 'DISCONNECT_FAILED', error)
    }
  }

  /**
   * Toggle integration enabled status
   */
  async toggle(integrationId: string, enabled: boolean) {
    try {
      const integration = await this.validateIntegrationOwnership(integrationId)

      if (integration.enabled === enabled) {
        logger.info(`Integration ${integrationId} is already ${enabled ? 'enabled' : 'disabled'}.`)
        return {
          success: true,
          message: `Integration already ${enabled ? 'enabled' : 'disabled'}.`,
        }
      }

      const providerType = integration.provider as IntegrationProviderType | 'chat'

      // Handle webhook registration/unregistration for non-chat providers
      if (providerType !== 'chat' && providerType !== 'openphone') {
        if (enabled) {
          logger.info(
            `Enabling integration ${integrationId} (${providerType}). Registering webhooks.`
          )
          await withAuthErrorHandling(
            () =>
              MessageService.registerWebhooks(
                this.organizationId,
                providerType as IntegrationProviderType,
                integrationId
              ),
            { provider: providerType as IntegrationProviderType, integrationId }
          ).catch((err) =>
            logger.error('Webhook registration failed during enable, proceeding.', {
              err,
              integrationId,
            })
          )
        } else {
          logger.info(
            `Disabling integration ${integrationId} (${providerType}). Unregistering webhooks.`
          )
          await MessageService.unregisterWebhooks(
            this.organizationId,
            providerType as IntegrationProviderType,
            integrationId
          ).catch((err) =>
            logger.error('Webhook unregistration failed during disable, proceeding.', {
              err,
              integrationId,
            })
          )
        }
      } else {
        logger.info(
          `${enabled ? 'Enabling' : 'Disabling'} integration ${integrationId} (${providerType}). No webhook action needed.`
        )
      }

      await this.db
        .update(schema.Integration)
        .set({ enabled })
        .where(eq(schema.Integration.id, integrationId))
      logger.info(`Integration ${integrationId} status updated to ${enabled}.`)

      return {
        success: true,
        message: `Integration successfully ${enabled ? 'enabled' : 'disabled'}.`,
      }
    } catch (error: any) {
      if (error instanceof IntegrationError) throw error
      logger.error(`Error toggling integration ${integrationId}:`, { error: error.message })
      throw new IntegrationError(`Failed to update integration status`, 'TOGGLE_FAILED', error)
    }
  }

  /**
   * Sync messages for a specific integration
   */
  async syncMessages(integrationId: string, days: number) {
    try {
      const integration = await this.validateIntegrationOwnership(integrationId)

      if (!integration.enabled) {
        throw new IntegrationError(
          'Cannot sync messages for disabled integration',
          'INTEGRATION_DISABLED'
        )
      }

      if (integration.provider === 'chat') {
        logger.warn(
          `SyncMessages called for chat integration ${integrationId}. Sync is not applicable.`
        )
        throw new IntegrationError(
          'Message synchronization is not applicable for chat widgets',
          'INVALID_PROVIDER'
        )
      }

      const since = new Date()
      since.setDate(since.getDate() - days)
      logger.info(
        `Starting manual sync for integration ${integrationId} (${integration.provider}) since ${since.toISOString()}`
      )

      if (!this.userId) {
        throw new IntegrationError(
          'User ID required for message synchronization',
          'USER_ID_REQUIRED'
        )
      }

      const syncer = new SyncMessages(this.db, this.organizationId, this.userId)
      return await syncer.sync({ integrationId, since })
    } catch (error: any) {
      if (error instanceof IntegrationError) throw error
      logger.error(`Error triggering manual sync for integration ${integrationId}:`, {
        error: error.message,
      })
      throw new IntegrationError(`Failed to start message sync`, 'SYNC_FAILED', error)
    }
  }

  /**
   * Sync messages for all enabled integrations
   */
  async syncAllMessages(days: number) {
    try {
      const since = new Date()
      since.setDate(since.getDate() - days)
      logger.info(
        `Starting manual sync for ALL enabled integrations since ${since.toISOString()}`,
        { organizationId: this.organizationId }
      )

      if (!this.userId) {
        throw new IntegrationError(
          'User ID required for message synchronization',
          'USER_ID_REQUIRED'
        )
      }

      const syncer = new SyncMessages(this.db, this.organizationId, this.userId)
      return await syncer.sync({ since })
    } catch (error: any) {
      if (error instanceof IntegrationError) throw error
      logger.error('Error syncing messages from all providers:', {
        error: error.message,
        organizationId: this.organizationId,
      })
      throw new IntegrationError(`Failed to sync all messages`, 'SYNC_ALL_FAILED', error)
    }
  }

  /**
   * Add OpenPhone integration
   */
  async addOpenPhoneIntegration(input: OpenPhoneInput) {
    try {
      logger.info('Attempting to add OpenPhone integration', {
        organizationId: this.organizationId,
        phoneNumber: input.phoneNumber,
      })

      if (!this.userId) {
        throw new IntegrationError(
          'User ID required for adding OpenPhone integration',
          'USER_ID_REQUIRED'
        )
      }

      const openPhoneService = new OpenPhoneService(this.db, this.organizationId, this.userId)
      return await openPhoneService.addIntegration(input)
    } catch (error: any) {
      logger.error('Error adding OpenPhone integration:', {
        error: error.message,
        organizationId: this.organizationId,
      })
      throw new IntegrationError(
        'Failed to add OpenPhone integration',
        'ADD_OPENPHONE_FAILED',
        error
      )
    }
  }

  /**
   * Get provider type for an integration
   */
  async getProviderType(integrationId: string) {
    try {
      const [integration] = await this.db
        .select({ provider: schema.Integration.provider })
        .from(schema.Integration)
        .where(
          and(
            eq(schema.Integration.id, integrationId),
            eq(schema.Integration.organizationId, this.organizationId)
          )
        )
        .limit(1)

      if (!integration) {
        throw new IntegrationError('Integration not found', 'INTEGRATION_NOT_FOUND')
      }

      return { provider: integration.provider }
    } catch (error: any) {
      if (error instanceof IntegrationError) throw error
      logger.error('Error getting provider type:', {
        error: error.message,
        integrationId,
      })
      throw new IntegrationError('Failed to get provider type', 'GET_PROVIDER_TYPE_FAILED', error)
    }
  }

  /**
   * Update integration settings
   */
  async updateSettings(integrationId: string, settings: IntegrationSettings) {
    try {
      await this.validateIntegrationOwnership(integrationId)

      // Get current metadata
      const [integration] = await this.db
        .select({ metadata: schema.Integration.metadata })
        .from(schema.Integration)
        .where(
          and(
            eq(schema.Integration.id, integrationId),
            eq(schema.Integration.organizationId, this.organizationId)
          )
        )
        .limit(1)

      if (!integration) {
        throw new IntegrationError('Integration not found', 'INTEGRATION_NOT_FOUND')
      }

      // Merge new settings into metadata.settings
      const currentMetadata = (integration.metadata as any) || {}
      const currentSettings = (currentMetadata.settings as IntegrationSettings) || {}
      const updatedSettings = {
        ...currentSettings,
        ...settings,
      }

      const updatedMetadata = {
        ...currentMetadata,
        settings: updatedSettings,
      }

      // Update the integration with new metadata
      const [updated] = await this.db
        .update(schema.Integration)
        .set({ metadata: updatedMetadata })
        .where(eq(schema.Integration.id, integrationId))
        .returning({ metadata: schema.Integration.metadata })

      logger.info('Updated integration settings', {
        integrationId,
        settings,
        organizationId: this.organizationId,
      })

      return {
        success: true,
        message: 'Settings updated successfully',
        settings: (updated?.metadata as any)?.settings || updatedSettings,
      }
    } catch (error: any) {
      if (error instanceof IntegrationError) throw error
      logger.error('Error updating integration settings:', {
        error: error.message,
        integrationId,
      })
      throw new IntegrationError('Failed to update settings', 'UPDATE_SETTINGS_FAILED', error)
    }
  }

  /**
   * Update allowed senders for a forwarding integration.
   */
  async updateAllowedSenders(integrationId: string, allowedSenders: string[]) {
    try {
      await this.validateIntegrationOwnership(integrationId)

      const [integration] = await this.db
        .select({ metadata: schema.Integration.metadata })
        .from(schema.Integration)
        .where(
          and(
            eq(schema.Integration.id, integrationId),
            eq(schema.Integration.organizationId, this.organizationId)
          )
        )
        .limit(1)

      if (!integration) {
        throw new IntegrationError('Integration not found', 'INTEGRATION_NOT_FOUND')
      }

      const currentMetadata = (integration.metadata as any) || {}
      if (currentMetadata.channelType !== 'forwarding-address') {
        throw new IntegrationError(
          'Only forwarding integrations support allowed senders',
          'INVALID_INTEGRATION_TYPE'
        )
      }

      const normalized = [
        ...new Set(allowedSenders.map((s) => s.trim().toLowerCase()).filter(Boolean)),
      ]

      const updatedMetadata = {
        ...currentMetadata,
        allowedSenders: normalized,
      }

      await this.db
        .update(schema.Integration)
        .set({ metadata: updatedMetadata })
        .where(eq(schema.Integration.id, integrationId))

      logger.info('Updated allowed senders', {
        integrationId,
        count: normalized.length,
        organizationId: this.organizationId,
      })

      return { allowedSenders: normalized }
    } catch (error: any) {
      if (error instanceof IntegrationError) throw error
      logger.error('Error updating allowed senders:', {
        error: error.message,
        integrationId,
      })
      throw new IntegrationError(
        'Failed to update allowed senders',
        'UPDATE_ALLOWED_SENDERS_FAILED',
        error
      )
    }
  }

  /**
   * Static method to get all stats
   */
  static async getAllStats(db: Database, organizationId: string) {
    try {
      const integrations = await MessageService.getAllIntegrations(organizationId)

      if (!integrations || integrations.length === 0) {
        logger.info('No active integrations found, returning empty stats.', { organizationId })
        return { providers: {}, total: { total: 0, inbox: 0, sent: 0, draft: 0, other: 0 } }
      }

      const providerStats: Record<string, any> = {}
      const totalStats = {
        total_email: 0,
        inbox: 0,
        sent: 0,
        draft: 0,
        total_other: 0,
      }

      for (const integration of integrations) {
        logger.debug(`Fetching stats for integration ${integration.id} (${integration.type})`)

        // Get total message count for this integration
        const [messageCountResult] = await db
          .select({ count: count() })
          .from(schema.Message)
          .where(
            and(
              eq(schema.Message.integrationId, integration.id),
              eq(schema.Message.organizationId, organizationId)
            )
          )
        const totalMessages = messageCountResult?.count ?? 0

        const stats = {
          total_email: totalMessages,
          inbox: 0, // emailLabel removed - no longer tracked
          sent: 0, // emailLabel removed - no longer tracked
          draft: 0, // emailLabel removed - no longer tracked
          total_other: 0,
          lastSyncedAt: (integration as any).lastSyncedAt ?? null,
          providerType: integration.type,
          integrationId: integration.id,
          identifier: integration.details.identifier,
        }

        totalStats.total_email += totalMessages

        const key = `${integration.type}-${integration.id}`
        providerStats[key] = stats
        logger.debug(`Stats calculated for ${key}`, { stats })
      }

      logger.info('Successfully calculated message statistics', { organizationId, totalStats })
      return { providers: providerStats, total: totalStats }
    } catch (error: any) {
      logger.error('Error getting message statistics:', { error: error.message, organizationId })
      throw new IntegrationError('Failed to get message statistics', 'GET_STATS_FAILED', error)
    }
  }
}
