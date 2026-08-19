// packages/lib/src/channels/disconnect.ts

import { type Database, schema, type Transaction } from '@auxx/database'
import { and, eq, sql } from 'drizzle-orm'
import { clearImportCache } from '../email/polling-import-cache'
import type { NotFoundError } from '../errors'
import { enqueueStorageCleanupJob } from '../jobs/maintenance/storage-cleanup-job'
import { createScopedLogger } from '../logger'
import { FacebookOAuthService } from '../providers/facebook/facebook-oauth'
import { GoogleOAuthService } from '../providers/google/google-oauth'
import { InstagramOAuthService } from '../providers/instagram/instagram-oauth'
import { OutlookOAuthService } from '../providers/outlook/outlook-oauth'
import { whereThreadProvider } from '../providers/query-helpers'
import { Result, type TypedResult } from '../result'
import { validateChannelOwnership } from './internal/validate'
import type { ChannelCtx } from './types'

const logger = createScopedLogger('channels.disconnect')

type DbHandle = Database | Transaction

/**
 * Mark a channel's data for destruction and drop its threads.
 *
 * Deliberately does NOT hard-delete media. Attachment assets carry derived rows
 * (thumbnails are their own `MediaAsset`, linked back through
 * `MediaAssetVersion.derivedFromVersionId`, a self-FK with NO ACTION on delete), so a
 * `DELETE` here can raise 23503 and take the whole disconnect with it — leaving the
 * channel permanently undisconnectable. Everything below is set-based and UPDATE-only
 * apart from the thread delete, which cascades cleanly. The destructive half runs in
 * `storageCleanupJob`, where it is batched and retryable.
 *
 * Exported for the personal-inbox delete path (§11.4), which destroys channel data
 * without the ownership validation `disconnect` performs (its integration is already
 * soft-deleted).
 */
export async function deleteChannelData(tx: DbHandle, channelId: string, provider: string) {
  logger.warn(`Deleting data for channel: ${channelId} (${provider})`)

  if (provider === 'chat') {
    // Filtered by provider, not `MessageType.CHAT` — that value also covers
    // facebook/instagram/whatsapp now (message-type-overhaul), and this branch means the
    // `chat` provider specifically. The `integrationId` equality below already pins one
    // Integration, so this was trivially true either way; spelled out by provider to stay
    // correct if that ever changes.
    await tx
      .delete(schema.Thread)
      .where(and(eq(schema.Thread.integrationId, channelId), whereThreadProvider('chat')))
    logger.info(`Deleted CHAT threads for channel ${channelId}`)
    return
  }

  // Email body blobs. Nothing else points at these StorageLocations once the messages
  // below are gone, so marking them here is safe to sweep whenever the job runs.
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

  // Soft-delete the attachment assets while the `Message` rows they hang off still
  // exist — this is the last moment the join is available. The job purges them for
  // real; until then the markers keep them off read paths, and a soft-deleted source
  // version is exactly what `cleanupOrphanedThumbnails` treats as orphaned, so the
  // nightly reaper is a free backstop if the job never lands.
  const channelAssetIds = sql`(
    SELECT a."assetId"
    FROM ${schema.Attachment} a
    JOIN ${schema.Message} m ON m."id" = a."entityId"
    WHERE a."entityType" = 'MESSAGE'
      AND a."assetId" IS NOT NULL
      AND m."integrationId" = ${channelId}
  )`

  await tx
    .update(schema.MediaAssetVersion)
    .set({ deletedAt: new Date() })
    .where(
      sql`${schema.MediaAssetVersion.assetId} IN ${channelAssetIds} AND ${schema.MediaAssetVersion.deletedAt} IS NULL`
    )

  await tx
    .update(schema.MediaAsset)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(
      sql`${schema.MediaAsset.id} IN ${channelAssetIds} AND ${schema.MediaAsset.deletedAt} IS NULL`
    )

  // One statement: `Message`, `ThreadEvent`, `MessageParticipant`, `ThreadParticipant`,
  // `LabelsOnThread`, `Draft`, `ScheduledMessage`, `ThreadExternalKey`, `ThreadReadStatus`
  // and `EmailEmbedding` all cascade off `Thread`. Deleting messages first would only
  // churn `Thread.latestMessageId` (SET NULL) on the way out.
  //
  // 🔴 Stays synchronous. `Thread` has no soft-delete column and no mail list path
  // filters on `Integration.deletedAt`, so deferring this leaves disconnected mail
  // sitting in the inbox until the worker catches up.
  await tx.delete(schema.Thread).where(eq(schema.Thread.integrationId, channelId))
  logger.info(`Deleted threads for channel ${channelId}, media marked for async purge`)
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

  // Disconnecting removes threads wholesale — invalidate every member's
  // sidebar counters via the org epoch (reconciled lazily on next read).
  const { bumpMailCountsEpoch } = await import('../threads/mail-counts')
  await bumpMailCountsEpoch(ctx.organizationId)

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
