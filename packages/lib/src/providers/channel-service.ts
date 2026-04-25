// packages/lib/src/providers/channel-service.ts

import { type Database, schema } from '@auxx/database'
import { toRecordId } from '@auxx/types/resource'
import crypto from 'crypto'
import { and, count, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import { withAuthErrorHandling } from '../email/errors-handlers'
import { MessageService } from '../email/message-service'
import { clearImportCache, getImportCacheSize } from '../email/polling-import-cache'
import { enqueueStorageCleanupJob } from '../jobs/maintenance/storage-cleanup-job'
import { createScopedLogger } from '../logger'
import { SyncMessages } from '../messages/sync-messages'
import { ThreadMutationService } from '../threads/thread-mutation.service'
import { FacebookOAuthService } from './facebook/facebook-oauth'
import { GoogleOAuthService } from './google/google-oauth'
import { InstagramOAuthService } from './instagram/instagram-oauth'
import { OpenPhoneService } from './openphone/openphone-service'
import { OutlookOAuthService } from './outlook/outlook-oauth'
import { getEmailProviders, whereThreadMessageType } from './query-helpers'
import type { ChannelProviderType } from './types'

const logger = createScopedLogger('channel-service')

/**
 * Interface for channel settings
 */
interface ChannelSettings {
  recordCreation?: {
    mode: 'all' | 'selective' | 'none'
  }
  excludeSenders?: string[]
  excludeRecipients?: string[]
  onlyProcessRecipients?: string[]
}

/**
 * Interface for OpenPhone channel input
 */
interface OpenPhoneInput {
  apiKey: string
  phoneNumberId: string
  phoneNumber: string
  webhookSigningSecret: string
}

/**
 * Custom error class for channel-related errors
 */
class ChannelError extends Error {
  constructor(
    message: string,
    public code: string,
    public cause?: unknown
  ) {
    super(message)
    this.name = 'ChannelError'
  }
}

/**
 * Service for managing channels
 */
export class ChannelService {
  private db: Database
  private organizationId: string
  private userId?: string

  constructor(db: Database, organizationId: string, userId?: string) {
    this.db = db
    this.organizationId = organizationId
    this.userId = userId
  }

  /**
   * Helper to safely extract identifier from channel
   */
  private getIdentifier(
    channel:
      | (typeof schema.Integration.$inferSelect & {
          chatWidget?: typeof schema.ChatWidget.$inferSelect | null
        })
      | null
  ): string | undefined {
    if (!channel) return undefined
    if (channel.provider === 'chat' && channel.chatWidget) {
      return channel.chatWidget.name
    }
    // Forwarding channels store the alias in Integration.email
    if (channel.email) return channel.email
    const metadata = channel.metadata
    if (metadata && typeof metadata === 'object') {
      if ('email' in metadata && typeof metadata.email === 'string') return metadata.email
      if ('phoneNumber' in metadata && typeof metadata.phoneNumber === 'string')
        return metadata.phoneNumber
    }
    return channel.name || undefined
  }

  /**
   * Validate that a channel belongs to the organization
   */
  private async validateChannelOwnership(channelId: string) {
    const [channel] = await this.db
      .select()
      .from(schema.Integration)
      .leftJoin(schema.ChatWidget, eq(schema.ChatWidget.integrationId, schema.Integration.id))
      .where(and(eq(schema.Integration.id, channelId), isNull(schema.Integration.deletedAt)))
      .limit(1)

    if (!channel?.Integration || channel.Integration.organizationId !== this.organizationId) {
      throw new ChannelError('Channel not found or access denied', 'CHANNEL_NOT_FOUND')
    }

    return {
      ...channel.Integration,
      chatWidget: channel.ChatWidget,
    }
  }

  /**
   * Delete threads and messages associated with a channel,
   * cleaning up MediaAssets and marking StorageLocations for async S3 deletion.
   */
  private async deleteChannelData(tx: typeof this.db, channelId: string, provider: string) {
    logger.warn(`Deleting data for channel: ${channelId} (${provider})`)

    if (provider === 'chat') {
      await tx
        .delete(schema.Thread)
        .where(and(eq(schema.Thread.integrationId, channelId), whereThreadMessageType('CHAT')))
      logger.info(`Deleted CHAT threads for channel ${channelId}`)
      return
    }

    // 1. Collect all messageIds for this channel
    const messageRows = await tx
      .select({ id: schema.Message.id })
      .from(schema.Message)
      .where(eq(schema.Message.integrationId, channelId))
    const messageIds = messageRows.map((r) => r.id)
    logger.info(`Found ${messageIds.length} messages for channel ${channelId}`)

    if (messageIds.length > 0) {
      // 2. Collect MediaAsset IDs via Attachment (polymorphic entityType='MESSAGE')
      const assetRows = await tx
        .selectDistinct({ assetId: schema.Attachment.assetId })
        .from(schema.Attachment)
        .where(
          and(
            eq(schema.Attachment.entityType, 'MESSAGE'),
            inArray(schema.Attachment.entityId, messageIds),
            isNotNull(schema.Attachment.assetId)
          )
        )
      const mediaAssetIds = assetRows.map((r) => r.assetId).filter(Boolean) as string[]
      logger.info(`Found ${mediaAssetIds.length} MediaAssets for channel ${channelId}`)

      // 3. Mark email body StorageLocations as deleted
      await tx
        .update(schema.StorageLocation)
        .set({ deletedAt: new Date() })
        .where(
          sql`${schema.StorageLocation.id} IN (
            SELECT ${schema.Message.htmlBodyStorageLocationId}
            FROM ${schema.Message}
            WHERE ${schema.Message.integrationId} = ${channelId}
            AND ${schema.Message.htmlBodyStorageLocationId} IS NOT NULL
          )`
        )

      // 4. Mark attachment StorageLocations as deleted (via MediaAssetVersion)
      if (mediaAssetIds.length > 0) {
        await tx
          .update(schema.StorageLocation)
          .set({ deletedAt: new Date() })
          .where(
            sql`${schema.StorageLocation.id} IN (
              SELECT ${schema.MediaAssetVersion.storageLocationId}
              FROM ${schema.MediaAssetVersion}
              WHERE ${schema.MediaAssetVersion.assetId} IN (${sql.join(
                mediaAssetIds.map((id) => sql`${id}`),
                sql`, `
              )})
              AND ${schema.MediaAssetVersion.storageLocationId} IS NOT NULL
            )`
          )

        // 5. Delete MediaAssets (cascades to Attachment + MediaAssetVersion via FK)
        await tx.delete(schema.MediaAsset).where(inArray(schema.MediaAsset.id, mediaAssetIds))
        logger.info(`Deleted ${mediaAssetIds.length} MediaAssets for channel ${channelId}`)
      }
    }

    // 6. Delete Messages
    await tx.delete(schema.Message).where(eq(schema.Message.integrationId, channelId))
    logger.info(`Deleted messages for channel ${channelId}`)

    // 7. Delete Threads
    await tx.delete(schema.Thread).where(eq(schema.Thread.integrationId, channelId))
    logger.info(`Deleted threads for channel ${channelId}`)
  }

  /**
   * Get OAuth URL for provider authentication
   */
  async getAuthUrl(provider: ChannelProviderType, redirectPath?: string) {
    try {
      if (provider === 'chat') {
        throw new ChannelError(
          'OAuth authentication is not applicable for chat widgets',
          'INVALID_PROVIDER'
        )
      }

      if (!this.userId) {
        throw new ChannelError('User ID required for OAuth authentication', 'USER_ID_REQUIRED')
      }

      let authUrl: string | null = null
      const csrfToken = crypto.randomBytes(32).toString('hex')

      switch (provider) {
        case 'google': {
          authUrl = await GoogleOAuthService.getAuthUrl(this.organizationId, this.userId, {
            redirectPath,
            csrfToken,
          })
          break
        }
        case 'outlook': {
          authUrl = await OutlookOAuthService.getAuthUrl(this.organizationId, this.userId, {
            redirectPath,
            csrfToken,
          })
          break
        }
        case 'facebook': {
          const facebookOAuthService = FacebookOAuthService.getInstance()
          authUrl = await facebookOAuthService.getAuthUrl(this.organizationId, this.userId, {
            redirectPath,
            csrfToken,
          })
          break
        }
        case 'instagram': {
          const instagramOAuthService = InstagramOAuthService.getInstance()
          authUrl = instagramOAuthService.getAuthUrl(this.organizationId, this.userId, {
            redirectPath,
            csrfToken,
          })
          break
        }
        default:
          throw new ChannelError(`Unsupported provider: ${provider}`, 'UNSUPPORTED_PROVIDER')
      }

      return { authUrl, csrfToken }
    } catch (error: any) {
      logger.error('Error generating auth URL:', {
        error: error.message,
        provider,
      })

      if (error instanceof ChannelError) {
        throw error
      }

      throw new ChannelError(
        `Failed to generate authorization URL for ${provider}`,
        'AUTH_URL_FAILED',
        error
      )
    }
  }

  /**
   * Get all channels for the organization
   */
  async getAllChannels() {
    try {
      const channelsData = await this.db
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
        .where(
          and(
            eq(schema.Integration.organizationId, this.organizationId),
            isNull(schema.Integration.deletedAt)
          )
        )
        .orderBy(schema.Integration.provider, desc(schema.Integration.createdAt))

      const channels = channelsData

      const formattedChannels = channels.map((int) => {
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
          settings: ((int.metadata as any)?.settings as ChannelSettings) || {},
        }
      })

      // Enrich syncing channels with pending import counts from Redis
      const syncingIds = formattedChannels
        .filter((int) => int.syncStatus === 'SYNCING')
        .map((int) => int.id)

      const importCounts = await Promise.all(
        syncingIds.map(async (id) => ({ id, count: await getImportCacheSize(id) }))
      )
      const countMap = new Map(importCounts.map((c) => [c.id, c.count]))

      const enriched = formattedChannels.map((int) => ({
        ...int,
        pendingImportCount: countMap.get(int.id) ?? 0,
      }))

      return { channels: enriched }
    } catch (error: any) {
      logger.error('Error getting channels:', {
        error: error.message,
        organizationId: this.organizationId,
      })
      throw new ChannelError('Failed to get channels', 'GET_CHANNELS_FAILED', error)
    }
  }

  /**
   * Get email client channels
   */
  async getEmailClients() {
    try {
      const channels = await this.db
        .select({
          id: schema.Integration.id,
          provider: schema.Integration.provider,
          name: schema.Integration.name,
          email: schema.Integration.email,
          metadata: schema.Integration.metadata,
          inboxId: schema.InboxIntegration.inboxId,
          isExample: schema.Integration.isExample,
        })
        .from(schema.Integration)
        .leftJoin(
          schema.InboxIntegration,
          eq(schema.InboxIntegration.integrationId, schema.Integration.id)
        )
        .where(
          and(
            eq(schema.Integration.organizationId, this.organizationId),
            inArray(schema.Integration.provider, getEmailProviders()),
            isNull(schema.Integration.deletedAt)
          )
        )

      const emailClients = channels.map((int) => {
        // Prefer Integration.email (used by forwarding channels), fall back to metadata.email
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
          settings: ((int.metadata as any)?.settings as ChannelSettings) || {},
          inboxId: int.inboxId,
          isExample: int.isExample,
        }
      })
      return emailClients
    } catch (error: any) {
      logger.error('Error getting email clients:', {
        error: error.message,
        organizationId: this.organizationId,
      })
      throw new ChannelError('Failed to get email clients', 'GET_EMAIL_CLIENTS_FAILED', error)
    }
  }

  /**
   * Disconnect a channel
   */
  async disconnect(channelId: string) {
    try {
      const channel = await this.validateChannelOwnership(channelId)

      // Revoke external access if applicable
      if (channel.provider) {
        try {
          switch (channel.provider) {
            case 'google':
              await GoogleOAuthService.revokeAccess(channelId)
              break
            case 'outlook':
              await OutlookOAuthService.revokeAccess(channelId)
              break
            case 'facebook':
              await FacebookOAuthService.getInstance().revokeAccess(channelId)
              break
            case 'instagram':
              await InstagramOAuthService.getInstance().revokeAccess(channelId)
              break
          }
          logger.info(
            `Successfully revoked access for channel ${channelId} via ${channel.provider} service.`
          )
        } catch (revokeError: any) {
          logger.error(
            `Failed to revoke access via ${channel.provider} service, continuing deletion:`,
            { error: revokeError.message, channelId }
          )
        }
      }

      // Collect affected inbox IDs before deleting data (for count cleanup)
      const affectedInboxRows = await this.db
        .selectDistinct({ inboxId: schema.Thread.inboxId })
        .from(schema.Thread)
        .where(and(eq(schema.Thread.integrationId, channelId), isNotNull(schema.Thread.inboxId)))
      const affectedInboxIds = affectedInboxRows.map((r) => r.inboxId).filter(Boolean) as string[]

      // Perform database cleanup within a transaction
      await this.db.transaction(async (tx) => {
        // Clean up MediaAssets, mark StorageLocations, delete Messages/Threads
        await this.deleteChannelData(tx, channelId, channel.provider)

        // Soft-delete Integration (partial unique index allows reconnect)
        await tx
          .update(schema.Integration)
          .set({ deletedAt: new Date(), enabled: false })
          .where(eq(schema.Integration.id, channelId))
        logger.info(`Soft-deleted channel record ${channelId} (${channel.provider}).`)
      })

      // Clear Redis polling cache inline (fast DEL operation)
      await clearImportCache(channelId)

      // Delete stale cached inbox counts for affected inboxes
      if (affectedInboxIds.length > 0) {
        await this.db
          .delete(schema.UserInboxUnreadCount)
          .where(inArray(schema.UserInboxUnreadCount.inboxId, affectedInboxIds))
        logger.info(
          `Deleted stale UserInboxUnreadCount rows for inboxes: ${affectedInboxIds.join(', ')}`
        )
      }

      // Enqueue async job for S3 deletion, Redis cleanup, and hard-delete
      await enqueueStorageCleanupJob({
        type: 'integration',
        organizationId: this.organizationId,
        integrationId: channelId,
      })

      return {
        success: true,
        message: `Channel ${channel.provider} disconnected successfully.`,
      }
    } catch (error: any) {
      if (error instanceof ChannelError) throw error
      logger.error('Error disconnecting channel:', { error: error.message, channelId })
      throw new ChannelError(`Failed to disconnect channel`, 'DISCONNECT_FAILED', error)
    }
  }

  /**
   * Toggle channel enabled status
   */
  async toggle(channelId: string, enabled: boolean) {
    try {
      const channel = await this.validateChannelOwnership(channelId)

      if (channel.enabled === enabled) {
        logger.info(`Channel ${channelId} is already ${enabled ? 'enabled' : 'disabled'}.`)
        return {
          success: true,
          message: `Channel already ${enabled ? 'enabled' : 'disabled'}.`,
        }
      }

      const providerType = channel.provider as ChannelProviderType | 'chat'

      // Handle webhook registration/unregistration for non-chat providers
      if (providerType !== 'chat' && providerType !== 'openphone') {
        if (enabled) {
          logger.info(`Enabling channel ${channelId} (${providerType}). Registering webhooks.`)
          await withAuthErrorHandling(
            () =>
              MessageService.registerWebhooks(
                this.organizationId,
                providerType as ChannelProviderType,
                channelId
              ),
            { provider: providerType as ChannelProviderType, integrationId: channelId }
          ).catch((err) =>
            logger.error('Webhook registration failed during enable, proceeding.', {
              err,
              channelId,
            })
          )
        } else {
          logger.info(`Disabling channel ${channelId} (${providerType}). Unregistering webhooks.`)
          await MessageService.unregisterWebhooks(
            this.organizationId,
            providerType as ChannelProviderType,
            channelId
          ).catch((err) =>
            logger.error('Webhook unregistration failed during disable, proceeding.', {
              err,
              channelId,
            })
          )
        }
      } else {
        logger.info(
          `${enabled ? 'Enabling' : 'Disabling'} channel ${channelId} (${providerType}). No webhook action needed.`
        )
      }

      await this.db
        .update(schema.Integration)
        .set({ enabled })
        .where(eq(schema.Integration.id, channelId))
      logger.info(`Channel ${channelId} status updated to ${enabled}.`)

      return {
        success: true,
        message: `Channel successfully ${enabled ? 'enabled' : 'disabled'}.`,
      }
    } catch (error: any) {
      if (error instanceof ChannelError) throw error
      logger.error(`Error toggling channel ${channelId}:`, { error: error.message })
      throw new ChannelError(`Failed to update channel status`, 'TOGGLE_FAILED', error)
    }
  }

  /**
   * Sync messages for a specific channel
   */
  async syncMessages(channelId: string, days: number) {
    try {
      const channel = await this.validateChannelOwnership(channelId)

      if (!channel.enabled) {
        throw new ChannelError('Cannot sync messages for disabled channel', 'CHANNEL_DISABLED')
      }

      if (channel.provider === 'chat') {
        logger.warn(`SyncMessages called for chat channel ${channelId}. Sync is not applicable.`)
        throw new ChannelError(
          'Message synchronization is not applicable for chat widgets',
          'INVALID_PROVIDER'
        )
      }

      // Use incremental History API when available (lastHistoryId exists),
      // only fall back to date-based sync for first-time syncs
      const since = channel.lastHistoryId
        ? undefined
        : (() => {
            const d = new Date()
            d.setDate(d.getDate() - days)
            return d
          })()

      logger.info(`Starting manual sync for channel ${channelId} (${channel.provider})`, {
        mode: since ? 'message-list' : 'history-api',
        since: since?.toISOString(),
        lastHistoryId: channel.lastHistoryId,
      })

      if (!this.userId) {
        throw new ChannelError('User ID required for message synchronization', 'USER_ID_REQUIRED')
      }

      const syncer = new SyncMessages(this.db, this.organizationId, this.userId)
      return await syncer.sync({ integrationId: channelId, since })
    } catch (error: any) {
      if (error instanceof ChannelError) throw error
      logger.error(`Error triggering manual sync for channel ${channelId}:`, {
        error: error.message,
      })
      throw new ChannelError(`Failed to start message sync`, 'SYNC_FAILED', error)
    }
  }

  /**
   * Sync messages for all enabled channels
   */
  async syncAllMessages(days: number) {
    try {
      const since = new Date()
      since.setDate(since.getDate() - days)
      logger.info(`Starting manual sync for ALL enabled channels since ${since.toISOString()}`, {
        organizationId: this.organizationId,
      })

      if (!this.userId) {
        throw new ChannelError('User ID required for message synchronization', 'USER_ID_REQUIRED')
      }

      const syncer = new SyncMessages(this.db, this.organizationId, this.userId)
      return await syncer.sync({ since })
    } catch (error: any) {
      if (error instanceof ChannelError) throw error
      logger.error('Error syncing messages from all providers:', {
        error: error.message,
        organizationId: this.organizationId,
      })
      throw new ChannelError(`Failed to sync all messages`, 'SYNC_ALL_FAILED', error)
    }
  }

  /**
   * Add OpenPhone channel
   */
  async addOpenPhoneChannel(input: OpenPhoneInput) {
    try {
      logger.info('Attempting to add OpenPhone channel', {
        organizationId: this.organizationId,
        phoneNumber: input.phoneNumber,
      })

      if (!this.userId) {
        throw new ChannelError('User ID required for adding OpenPhone channel', 'USER_ID_REQUIRED')
      }

      const openPhoneService = new OpenPhoneService(this.db, this.organizationId, this.userId)
      return await openPhoneService.addIntegration(input)
    } catch (error: any) {
      logger.error('Error adding OpenPhone channel:', {
        error: error.message,
        organizationId: this.organizationId,
      })
      throw new ChannelError('Failed to add OpenPhone channel', 'ADD_OPENPHONE_FAILED', error)
    }
  }

  /**
   * Get provider type for a channel
   */
  async getProviderType(channelId: string) {
    try {
      const [row] = await this.db
        .select({ provider: schema.Integration.provider })
        .from(schema.Integration)
        .where(
          and(
            eq(schema.Integration.id, channelId),
            eq(schema.Integration.organizationId, this.organizationId),
            isNull(schema.Integration.deletedAt)
          )
        )
        .limit(1)

      if (!row) {
        throw new ChannelError('Channel not found', 'CHANNEL_NOT_FOUND')
      }

      return { provider: row.provider }
    } catch (error: any) {
      if (error instanceof ChannelError) throw error
      logger.error('Error getting provider type:', {
        error: error.message,
        channelId,
      })
      throw new ChannelError('Failed to get provider type', 'GET_PROVIDER_TYPE_FAILED', error)
    }
  }

  /**
   * Get current channel settings.
   */
  async getSettings(channelId: string): Promise<ChannelSettings> {
    await this.validateChannelOwnership(channelId)

    const [row] = await this.db
      .select({ metadata: schema.Integration.metadata })
      .from(schema.Integration)
      .where(
        and(
          eq(schema.Integration.id, channelId),
          eq(schema.Integration.organizationId, this.organizationId)
        )
      )
      .limit(1)

    if (!row) {
      throw new ChannelError('Channel not found', 'CHANNEL_NOT_FOUND')
    }

    return ((row.metadata as any)?.settings as ChannelSettings) || {}
  }

  /**
   * Update channel settings.
   * Retroactively ignores threads for any newly added filter entries.
   */
  async updateSettings(channelId: string, settings: ChannelSettings) {
    try {
      await this.validateChannelOwnership(channelId)

      // Get current metadata (read before writing so we can diff)
      const [row] = await this.db
        .select({ metadata: schema.Integration.metadata })
        .from(schema.Integration)
        .where(
          and(
            eq(schema.Integration.id, channelId),
            eq(schema.Integration.organizationId, this.organizationId)
          )
        )
        .limit(1)

      if (!row) {
        throw new ChannelError('Channel not found', 'CHANNEL_NOT_FOUND')
      }

      const currentMetadata = (row.metadata as any) || {}
      const previousSettings = (currentMetadata.settings as ChannelSettings) || {}
      const updatedSettings = {
        ...previousSettings,
        ...settings,
      }

      const updatedMetadata = {
        ...currentMetadata,
        settings: updatedSettings,
      }

      // Update the channel with new metadata
      const [updated] = await this.db
        .update(schema.Integration)
        .set({ metadata: updatedMetadata })
        .where(eq(schema.Integration.id, channelId))
        .returning({ metadata: schema.Integration.metadata })

      logger.info('Updated channel settings', {
        channelId,
        settings,
        organizationId: this.organizationId,
      })

      // Retroactive updates for newly added filter entries
      await this.retroactivelyIgnoreThreads(channelId, previousSettings, settings)

      return {
        success: true,
        message: 'Settings updated successfully',
        settings: (updated?.metadata as any)?.settings || updatedSettings,
      }
    } catch (error: any) {
      if (error instanceof ChannelError) throw error
      logger.error('Error updating channel settings:', {
        error: error.message,
        channelId,
      })
      throw new ChannelError('Failed to update settings', 'UPDATE_SETTINGS_FAILED', error)
    }
  }

  /**
   * Add an email or domain to the excluded senders list.
   * Retroactively ignores matching threads.
   */
  async addExcludedSender(channelId: string, entry: string) {
    const current = await this.getSettings(channelId)
    const existing = current?.excludeSenders ?? []

    if (existing.includes(entry)) {
      return { success: true, message: 'Already excluded' }
    }

    return this.updateSettings(channelId, {
      excludeSenders: [...existing, entry],
    })
  }

  /**
   * Retroactively mark threads as IGNORED for newly added filter entries.
   */
  private async retroactivelyIgnoreThreads(
    channelId: string,
    previousSettings: ChannelSettings,
    newSettings: ChannelSettings
  ) {
    const threadMutation = new ThreadMutationService(this.organizationId, this.db)

    if (newSettings.excludeSenders) {
      const oldEntries = previousSettings.excludeSenders ?? []
      const added = newSettings.excludeSenders.filter((e) => !oldEntries.includes(e))
      for (const entry of added) {
        await threadMutation.ignoreThreadsByFilter(channelId, entry, 'sender')
      }
    }

    if (newSettings.excludeRecipients) {
      const oldEntries = previousSettings.excludeRecipients ?? []
      const added = newSettings.excludeRecipients.filter((e) => !oldEntries.includes(e))
      for (const entry of added) {
        await threadMutation.ignoreThreadsByFilter(channelId, entry, 'recipient')
      }
    }

    if (newSettings.onlyProcessRecipients?.length) {
      const threadIds = await threadMutation.findThreadIdsNotMatchingRecipients(
        channelId,
        newSettings.onlyProcessRecipients
      )
      if (threadIds.length > 0) {
        const recordIds = threadIds.map((id) => toRecordId('thread', id))
        await threadMutation.updateBulk(recordIds, { status: 'IGNORED' })
      }
    }
  }

  /**
   * Update allowed senders for a forwarding channel.
   */
  async updateAllowedSenders(channelId: string, allowedSenders: string[]) {
    try {
      await this.validateChannelOwnership(channelId)

      const [row] = await this.db
        .select({ metadata: schema.Integration.metadata })
        .from(schema.Integration)
        .where(
          and(
            eq(schema.Integration.id, channelId),
            eq(schema.Integration.organizationId, this.organizationId)
          )
        )
        .limit(1)

      if (!row) {
        throw new ChannelError('Channel not found', 'CHANNEL_NOT_FOUND')
      }

      const currentMetadata = (row.metadata as any) || {}
      if (currentMetadata.channelType !== 'forwarding-address') {
        throw new ChannelError(
          'Only forwarding channels support allowed senders',
          'INVALID_CHANNEL_TYPE'
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
        .where(eq(schema.Integration.id, channelId))

      logger.info('Updated allowed senders', {
        channelId,
        count: normalized.length,
        organizationId: this.organizationId,
      })

      return { allowedSenders: normalized }
    } catch (error: any) {
      if (error instanceof ChannelError) throw error
      logger.error('Error updating allowed senders:', {
        error: error.message,
        channelId,
      })
      throw new ChannelError(
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
      const channels = await MessageService.getAllIntegrations(organizationId)

      if (!channels || channels.length === 0) {
        logger.info('No active channels found, returning empty stats.', { organizationId })
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

      for (const channel of channels) {
        logger.debug(`Fetching stats for channel ${channel.id} (${channel.type})`)

        // Get total message count for this channel
        const [messageCountResult] = await db
          .select({ count: count() })
          .from(schema.Message)
          .where(
            and(
              eq(schema.Message.integrationId, channel.id),
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
          lastSyncedAt: (channel as any).lastSyncedAt ?? null,
          providerType: channel.type,
          channelId: channel.id,
          identifier: channel.details.identifier,
        }

        totalStats.total_email += totalMessages

        const key = `${channel.type}-${channel.id}`
        providerStats[key] = stats
        logger.debug(`Stats calculated for ${key}`, { stats })
      }

      logger.info('Successfully calculated message statistics', { organizationId, totalStats })
      return { providers: providerStats, total: totalStats }
    } catch (error: any) {
      logger.error('Error getting message statistics:', { error: error.message, organizationId })
      throw new ChannelError('Failed to get message statistics', 'GET_STATS_FAILED', error)
    }
  }
}
