// packages/lib/src/channels/manage-access.ts

import { TRPCError } from '@trpc/server'
import { getOrgCache } from '../cache'
import { getCapabilities, PermissionKey } from '../permissions'
import type { ChannelCtx } from './types'

/**
 * Whether the user may manage (toggle/sync/disconnect/update) a channel:
 * `channelsManage` capability, or the owner of the PERSONAL channel — i.e. the
 * channel's linked inbox is personal (§11) and owned by them. Shared channels
 * gate on the channels area's own key (plan 21 §6 — the role half of the old
 * `admin || owner` check became the capability; the ownership half is a §5.2
 * carve-out and stays). Cache reads only (capability blob + channels + inboxes).
 */
export async function canManageChannel(
  ctx: ChannelCtx & { userId: string },
  integrationId: string
): Promise<boolean> {
  const caps = await getCapabilities(ctx.userId, ctx.organizationId)
  if (caps.can(PermissionKey.channelsManage)) return true

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
