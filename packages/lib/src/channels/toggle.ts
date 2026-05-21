// packages/lib/src/channels/toggle.ts

import { schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { onCacheEvent } from '../cache'
import { withAuthErrorHandling } from '../email/errors-handlers'
import { MessageService } from '../email/message-service'
import type { NotFoundError } from '../errors'
import { createScopedLogger } from '../logger'
import type { ChannelProviderType } from '../providers/types'
import { Result, type TypedResult } from '../result'
import { validateChannelOwnership } from './internal/validate'
import type { ChannelCtx } from './types'

const logger = createScopedLogger('channels.toggle')

/**
 * Enable/disable a channel. Registers or unregisters webhooks for providers
 * that support them. Webhook failures log + continue (the toggle itself
 * still succeeds).
 */
export async function toggle(
  ctx: ChannelCtx,
  channelId: string,
  enabled: boolean
): Promise<TypedResult<{ success: true; message: string }, NotFoundError>> {
  const validated = await validateChannelOwnership(ctx, channelId)
  if (!validated.ok) return validated
  const channel = validated.value

  if (channel.enabled === enabled) {
    logger.info(`Channel ${channelId} is already ${enabled ? 'enabled' : 'disabled'}.`)
    return Result.ok({
      success: true,
      message: `Channel already ${enabled ? 'enabled' : 'disabled'}.`,
    })
  }

  const providerType = channel.provider as ChannelProviderType | 'chat'

  // Handle webhook registration/unregistration for non-chat providers
  if (providerType !== 'chat' && providerType !== 'openphone') {
    if (enabled) {
      logger.info(`Enabling channel ${channelId} (${providerType}). Registering webhooks.`)
      await withAuthErrorHandling(
        () =>
          MessageService.registerWebhooks(
            ctx.organizationId,
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
        ctx.organizationId,
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

  await ctx.db
    .update(schema.Integration)
    .set({ enabled })
    .where(eq(schema.Integration.id, channelId))
  logger.info(`Channel ${channelId} status updated to ${enabled}.`)

  await onCacheEvent('channel.toggled', { orgId: ctx.organizationId })

  return Result.ok({
    success: true,
    message: `Channel successfully ${enabled ? 'enabled' : 'disabled'}.`,
  })
}
