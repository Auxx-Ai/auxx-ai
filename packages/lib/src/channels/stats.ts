// packages/lib/src/channels/stats.ts

import { schema } from '@auxx/database'
import { and, count, eq } from 'drizzle-orm'
import { MessageService } from '../email/message-service'
import { createScopedLogger } from '../logger'
import type { ChannelCtx } from './types'

const logger = createScopedLogger('channels.stats')

/**
 * Aggregate message stats across every active channel in the org.
 * Surface returned by the admin "all email stats" endpoint.
 */
export async function getAllStats(ctx: ChannelCtx) {
  const channels = await MessageService.getAllIntegrations(ctx.organizationId)

  if (!channels || channels.length === 0) {
    logger.info('No active channels found, returning empty stats.', {
      organizationId: ctx.organizationId,
    })
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

    const [messageCountResult] = await ctx.db
      .select({ count: count() })
      .from(schema.Message)
      .where(
        and(
          eq(schema.Message.integrationId, channel.id),
          eq(schema.Message.organizationId, ctx.organizationId)
        )
      )
    const totalMessages = messageCountResult?.count ?? 0

    const stats = {
      total_email: totalMessages,
      inbox: 0, // emailLabel removed - no longer tracked
      sent: 0,
      draft: 0,
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

  logger.info('Successfully calculated message statistics', {
    organizationId: ctx.organizationId,
    totalStats,
  })
  return { providers: providerStats, total: totalStats }
}
