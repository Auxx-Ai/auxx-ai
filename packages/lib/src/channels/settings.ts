// packages/lib/src/channels/settings.ts

import { schema } from '@auxx/database'
import { toRecordId } from '@auxx/types/resource'
import { eq } from 'drizzle-orm'
import { onCacheEvent } from '../cache'
import { BadRequestError, type NotFoundError } from '../errors'
import { createScopedLogger } from '../logger'
import { Result, type TypedResult } from '../result'
import { ThreadMutationService } from '../threads/thread-mutation.service'
import { validateChannelOwnership } from './internal/validate'
import type { ChannelCtx, ChannelSettings } from './types'

const logger = createScopedLogger('channels.settings')

/**
 * Read current settings off `Integration.metadata.settings`.
 */
export async function getSettings(
  ctx: ChannelCtx,
  channelId: string
): Promise<TypedResult<ChannelSettings, NotFoundError>> {
  const validated = await validateChannelOwnership(ctx, channelId)
  if (!validated.ok) return validated

  const metadata = validated.value.metadata
  return Result.ok(((metadata as any)?.settings as ChannelSettings) || {})
}

type UpdateSettingsOk = { success: true; message: string; settings: ChannelSettings }

/**
 * Update channel settings. Retroactively marks threads as IGNORED for any
 * newly added filter entries.
 */
export async function updateSettings(
  ctx: ChannelCtx,
  channelId: string,
  settings: ChannelSettings
): Promise<TypedResult<UpdateSettingsOk, NotFoundError>> {
  const validated = await validateChannelOwnership(ctx, channelId)
  if (!validated.ok) return validated

  const currentMetadata = (validated.value.metadata as any) || {}
  const previousSettings = (currentMetadata.settings as ChannelSettings) || {}
  const updatedSettings = {
    ...previousSettings,
    ...settings,
  }

  const updatedMetadata = {
    ...currentMetadata,
    settings: updatedSettings,
  }

  const [updated] = await ctx.db
    .update(schema.Integration)
    .set({ metadata: updatedMetadata })
    .where(eq(schema.Integration.id, channelId))
    .returning({ metadata: schema.Integration.metadata })

  logger.info('Updated channel settings', {
    channelId,
    settings,
    organizationId: ctx.organizationId,
  })

  await retroactivelyIgnoreThreads(ctx, channelId, previousSettings, settings)

  await onCacheEvent('channel.settings_updated', { orgId: ctx.organizationId })

  return Result.ok({
    success: true,
    message: 'Settings updated successfully',
    settings: (updated?.metadata as any)?.settings || updatedSettings,
  })
}

/**
 * Add an email or domain to the excluded senders list. Idempotent.
 */
export async function addExcludedSender(
  ctx: ChannelCtx,
  channelId: string,
  entry: string
): Promise<TypedResult<UpdateSettingsOk | { success: true; message: string }, NotFoundError>> {
  const currentResult = await getSettings(ctx, channelId)
  if (!currentResult.ok) return currentResult
  const current = currentResult.value
  const existing = current?.excludeSenders ?? []

  if (existing.includes(entry)) {
    return Result.ok({ success: true, message: 'Already excluded' })
  }

  return updateSettings(ctx, channelId, {
    excludeSenders: [...existing, entry],
  })
}

/**
 * Retroactively mark threads as IGNORED for newly added filter entries.
 */
async function retroactivelyIgnoreThreads(
  ctx: ChannelCtx,
  channelId: string,
  previousSettings: ChannelSettings,
  newSettings: ChannelSettings
) {
  const threadMutation = new ThreadMutationService(ctx.organizationId, ctx.db)

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
export async function updateAllowedSenders(
  ctx: ChannelCtx,
  channelId: string,
  allowedSenders: string[]
): Promise<TypedResult<{ allowedSenders: string[] }, NotFoundError | BadRequestError>> {
  const validated = await validateChannelOwnership(ctx, channelId)
  if (!validated.ok) return validated

  const currentMetadata = (validated.value.metadata as any) || {}
  if (currentMetadata.channelType !== 'forwarding-address') {
    return Result.error(new BadRequestError('Only forwarding channels support allowed senders'))
  }

  const normalized = [...new Set(allowedSenders.map((s) => s.trim().toLowerCase()).filter(Boolean))]

  const updatedMetadata = {
    ...currentMetadata,
    allowedSenders: normalized,
  }

  await ctx.db
    .update(schema.Integration)
    .set({ metadata: updatedMetadata })
    .where(eq(schema.Integration.id, channelId))

  logger.info('Updated allowed senders', {
    channelId,
    count: normalized.length,
    organizationId: ctx.organizationId,
  })

  await onCacheEvent('channel.settings_updated', { orgId: ctx.organizationId })

  return Result.ok({ allowedSenders: normalized })
}
