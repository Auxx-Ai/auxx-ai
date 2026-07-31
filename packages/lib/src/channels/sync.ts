// packages/lib/src/channels/sync.ts

import { AuxxError, BadRequestError } from '../errors'
import { createScopedLogger } from '../logger'
import { SyncMessages } from '../messages/sync-messages'
import { Result, type TypedResult } from '../result'
import { validateChannelOwnership } from './internal/validate'
import type { ChannelCtx } from './types'

const logger = createScopedLogger('channels.sync')

/**
 * Sync messages for a specific channel. Uses incremental History API when
 * available; falls back to a date-based sync only on first-time imports.
 */
export async function syncMessages(
  ctx: ChannelCtx & { userId: string },
  channelId: string,
  days: number
): Promise<TypedResult<Awaited<ReturnType<SyncMessages['sync']>>, AuxxError>> {
  const validated = await validateChannelOwnership(ctx, channelId)
  if (!validated.ok) return validated
  const channel = validated.value

  if (!channel.enabled) {
    return Result.error(new BadRequestError('Cannot sync messages for disabled channel'))
  }

  if (channel.provider === 'chat') {
    logger.warn(`SyncMessages called for chat channel ${channelId}. Sync is not applicable.`)
    return Result.error(
      new BadRequestError('Message synchronization is not applicable for chat widgets')
    )
  }

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

  const syncer = new SyncMessages(ctx.db, ctx.organizationId, ctx.userId)
  try {
    const result = await syncer.sync({ integrationId: channelId, since })
    return Result.ok(result)
  } catch (error) {
    // `SyncMessages.sync` throws (already-syncing, throttled, missing channel).
    // Funnel those into the Result contract so the router maps them to a real
    // status instead of letting an unrecognized throw become a generic 500.
    if (error instanceof AuxxError) return Result.error(error)
    throw error
  }
}

/**
 * Sync messages for all enabled channels in the org.
 */
export async function syncAllMessages(ctx: ChannelCtx & { userId: string }, days: number) {
  const since = new Date()
  since.setDate(since.getDate() - days)
  logger.info(`Starting manual sync for ALL enabled channels since ${since.toISOString()}`, {
    organizationId: ctx.organizationId,
  })

  const syncer = new SyncMessages(ctx.db, ctx.organizationId, ctx.userId)
  return await syncer.sync({ since })
}
