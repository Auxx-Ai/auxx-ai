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

/**
 * The batched form of {@link canManageChannel}'s answer: either unrestricted
 * (the caller holds `channelsManage`, so no id predicate applies) or an explicit
 * allowlist of integration ids.
 *
 * Modelled as a discriminated union rather than "an id list, empty means all"
 * because the two collapse into the classic empty-`inArray` footgun: a caller
 * that drops an empty list turns "sees nothing" into "sees everything". With
 * `kind` the caller has to name which case it is handling.
 */
export type ChannelManageScope = { kind: 'all' } | { kind: 'ids'; integrationIds: string[] }

/**
 * Which channels the user may manage, as a scope a query can apply in SQL.
 *
 * Exists because {@link canManageChannel} is single-id only, so a list endpoint
 * (e.g. label sync config across channels) would otherwise have to call it once
 * per channel or, worse, re-derive the predicate. Same semantics, same two cache
 * reads (capability blob + `channels` + `inboxes`), zero DB queries — batched
 * over the org's channels instead of asking about one.
 *
 * **Deliberate divergence from `channels/list.ts`:** a channel whose `inboxId`
 * is `null` is EXCLUDED here, while `list.ts` keeps unlinked channels visible to
 * everyone (`!c.inboxId || !othersPersonal.has(c.inboxId)`). Visibility and
 * manage-authority genuinely disagree about unlinked channels: a channel with no
 * inbox link has no owner to carve out, so nothing makes a non-`channelsManage`
 * member its manager — its config is admin-only. This mirrors
 * {@link canManageChannel}'s `if (!channel?.inboxId) return false`. Do not
 * "consistency-fix" this against `list.ts` without first deciding which of the
 * two is wrong; a test pins it.
 */
export async function listManageableChannelIds(
  ctx: ChannelCtx & { userId: string }
): Promise<ChannelManageScope> {
  const caps = await getCapabilities(ctx.userId, ctx.organizationId)
  if (caps.can(PermissionKey.channelsManage)) return { kind: 'all' }

  const [channels, inboxes] = await Promise.all([
    getOrgCache().get(ctx.organizationId, 'channels'),
    getOrgCache().get(ctx.organizationId, 'inboxes'),
  ])

  const ownPersonalInboxIds = new Set(
    inboxes.filter((i) => i.isPersonal && i.ownerUserId === ctx.userId).map((i) => i.id)
  )

  return {
    kind: 'ids',
    integrationIds: channels
      .filter((c) => !!c.inboxId && ownPersonalInboxIds.has(c.inboxId))
      .map((c) => c.id),
  }
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
