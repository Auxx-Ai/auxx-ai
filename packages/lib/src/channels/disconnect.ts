// packages/lib/src/channels/disconnect.ts

import { type Database, schema, type Transaction } from '@auxx/database'
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import { clearImportCache } from '../email/polling-import-cache'
import type { NotFoundError } from '../errors'
import { enqueueStorageCleanupJob } from '../jobs/maintenance/storage-cleanup-job'
import { createScopedLogger } from '../logger'
import { FacebookOAuthService } from '../providers/facebook/facebook-oauth'
import { GoogleOAuthService } from '../providers/google/google-oauth'
import { InstagramOAuthService } from '../providers/instagram/instagram-oauth'
import { OutlookOAuthService } from '../providers/outlook/outlook-oauth'
import { whereThreadMessageType } from '../providers/query-helpers'
import { MessageType } from '../providers/types'
import { Result, type TypedResult } from '../result'
import { validateChannelOwnership } from './internal/validate'
import type { ChannelCtx } from './types'

const logger = createScopedLogger('channels.disconnect')

type DbHandle = Database | Transaction

/**
 * Delete threads + messages for a channel, clean up MediaAssets, and mark
 * StorageLocations for async S3 deletion.
 */
async function deleteChannelData(tx: DbHandle, channelId: string, provider: string) {
  logger.warn(`Deleting data for channel: ${channelId} (${provider})`)

  if (provider === 'chat') {
    await tx
      .delete(schema.Thread)
      .where(
        and(eq(schema.Thread.integrationId, channelId), whereThreadMessageType(MessageType.CHAT))
      )
    logger.info(`Deleted CHAT threads for channel ${channelId}`)
    return
  }

  const messageRows = await tx
    .select({ id: schema.Message.id })
    .from(schema.Message)
    .where(eq(schema.Message.integrationId, channelId))
  const messageIds = messageRows.map((r) => r.id)
  logger.info(`Found ${messageIds.length} messages for channel ${channelId}`)

  if (messageIds.length > 0) {
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

    // Mark email body StorageLocations as deleted
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

    // Mark attachment StorageLocations as deleted (via MediaAssetVersion)
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

      await tx.delete(schema.MediaAsset).where(inArray(schema.MediaAsset.id, mediaAssetIds))
      logger.info(`Deleted ${mediaAssetIds.length} MediaAssets for channel ${channelId}`)
    }
  }

  await tx.delete(schema.Message).where(eq(schema.Message.integrationId, channelId))
  logger.info(`Deleted messages for channel ${channelId}`)

  await tx.delete(schema.Thread).where(eq(schema.Thread.integrationId, channelId))
  logger.info(`Deleted threads for channel ${channelId}`)
}

/**
 * Disconnect a channel: revoke external access, soft-delete the row, queue
 * S3 cleanup, drop cached counts.
 */
export async function disconnect(
  ctx: ChannelCtx,
  channelId: string
): Promise<TypedResult<{ success: true; message: string }, NotFoundError>> {
  const validated = await validateChannelOwnership(ctx, channelId)
  if (!validated.ok) return validated
  const channel = validated.value

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
  const affectedInboxRows = await ctx.db
    .selectDistinct({ inboxId: schema.Thread.inboxId })
    .from(schema.Thread)
    .where(and(eq(schema.Thread.integrationId, channelId), isNotNull(schema.Thread.inboxId)))
  const affectedInboxIds = affectedInboxRows.map((r) => r.inboxId).filter(Boolean) as string[]

  await ctx.db.transaction(async (tx) => {
    await deleteChannelData(tx, channelId, channel.provider)

    // Soft-delete Integration (partial unique index allows reconnect)
    await tx
      .update(schema.Integration)
      .set({ deletedAt: new Date(), enabled: false })
      .where(eq(schema.Integration.id, channelId))
    logger.info(`Soft-deleted channel record ${channelId} (${channel.provider}).`)
  })

  // Clear Redis polling cache inline (fast DEL operation)
  await clearImportCache(channelId)

  if (affectedInboxIds.length > 0) {
    await ctx.db
      .delete(schema.UserInboxUnreadCount)
      .where(inArray(schema.UserInboxUnreadCount.inboxId, affectedInboxIds))
    logger.info(
      `Deleted stale UserInboxUnreadCount rows for inboxes: ${affectedInboxIds.join(', ')}`
    )
  }

  await enqueueStorageCleanupJob({
    type: 'integration',
    organizationId: ctx.organizationId,
    integrationId: channelId,
  })

  return Result.ok({
    success: true,
    message: `Channel ${channel.provider} disconnected successfully.`,
  })
}
