// packages/lib/src/channels/internal/validate.ts

import { schema } from '@auxx/database'
import { and, eq, isNull } from 'drizzle-orm'
import { NotFoundError } from '../../errors'
import { Result, type TypedResult } from '../../result'
import type { ChannelCtx } from '../types'

/**
 * Verify a channel exists, isn't soft-deleted, and belongs to the caller's
 * organization. Returns the joined Integration + ChatWidget row.
 */
export async function validateChannelOwnership(
  ctx: ChannelCtx,
  channelId: string
): Promise<TypedResult<ValidatedChannel, NotFoundError>> {
  const [channel] = await ctx.db
    .select()
    .from(schema.Integration)
    .leftJoin(schema.ChatWidget, eq(schema.ChatWidget.integrationId, schema.Integration.id))
    .where(and(eq(schema.Integration.id, channelId), isNull(schema.Integration.deletedAt)))
    .limit(1)

  if (!channel?.Integration || channel.Integration.organizationId !== ctx.organizationId) {
    return Result.error(new NotFoundError('Channel not found or access denied'))
  }

  return Result.ok({
    ...channel.Integration,
    chatWidget: channel.ChatWidget,
  })
}

export type ValidatedChannel = typeof schema.Integration.$inferSelect & {
  chatWidget: typeof schema.ChatWidget.$inferSelect | null
}
