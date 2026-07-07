// packages/lib/src/channels/manage-access.ts

import { TRPCError } from '@trpc/server'
import { getCachedUserMailVisibility, getOrgCache } from '../cache'
import type { ChannelCtx } from './types'

/**
 * Whether the user may manage (toggle/sync/disconnect/update) a channel:
 * org admin, or the owner of the PERSONAL channel — i.e. the channel's linked
 * inbox is personal (§11) and owned by them. Shared channels are admin-only.
 * Pure cache reads (channels + inboxes + user visibility), no DB.
 */
export async function canManageChannel(
  ctx: ChannelCtx & { userId: string },
  integrationId: string
): Promise<boolean> {
  const vis = await getCachedUserMailVisibility(ctx.userId, ctx.organizationId)
  if (vis.isAdmin) return true

  const channels = await getOrgCache().get(ctx.organizationId, 'channels')
  const channel = channels.find((c) => c.id === integrationId)
  if (!channel?.inboxId) return false

  const inboxes = await getOrgCache().get(ctx.organizationId, 'inboxes')
  const inbox = inboxes.find((i) => i.id === channel.inboxId)
  return !!inbox?.isPersonal && inbox.ownerUserId === ctx.userId
}

/** Throws FORBIDDEN unless {@link canManageChannel} allows the user. */
export async function requireChannelManageAccess(
  ctx: ChannelCtx & { userId: string },
  integrationId: string
): Promise<void> {
  if (!(await canManageChannel(ctx, integrationId))) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Only admins can manage shared channels',
    })
  }
}
