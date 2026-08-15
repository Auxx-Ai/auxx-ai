// packages/lib/src/channels/openphone-provisioning-hook.ts
// Post-connect provisioning for the Quo (formerly OpenPhone) SMS channel — a secret (API-key)
// connection.
//
// The connect form collects the API KEY AND NOTHING ELSE (see `connections/providers/defs.ts`):
// one connection = one Quo WORKSPACE, not one phone number. `connections.save` commits the
// Credential holding that key (encrypted), then runs this hook, which fetches the workspace's
// numbers, caches them on `Credential.metadata.quo`, and turns the ONE number the user picked
// into a channel.
//
// The picked `PN…` arrives via `ctx.extra.phoneNumberId` — `connections.save` forwards
// `input.postConnect` verbatim as `ctx.extra`, the same channel that already carries
// `pc_inboxId` → `ctx.extra.inboxId`.
//
// v1 is deliberately ONE CHANNEL PER CONNECT: auto-creating a channel per number would blow
// through `assertChannelLimit` on a workspace with many numbers and silently spend the org's
// plan allowance. Adding a second number is `channel.addQuoNumber` against this same Credential.
//
// All the actual work lives in `quo-channel.ts`, shared with that procedure. This hook is only
// the permission gate + input plumbing.

import { createScopedLogger } from '@auxx/logger'
import type { PostConnectHook, PostConnectHookContext } from '../connections/post-connect-hooks'
import { BadRequestError } from '../errors'
import { PermissionKey, requirePermission } from '../permissions'
import { provisionQuoChannel } from './quo-channel'

const logger = createScopedLogger('openphone-provisioning-hook')

/** The Quo (OpenPhone) channel post-connect hook — runs off the secret-save path. */
export const openphoneProvisioningHook: PostConnectHook = {
  providerKeys: ['openphone'],
  async run(ctx: PostConnectHookContext): Promise<void> {
    // Channels require the channels.manage capability (the generic secret-save allows any member).
    await requirePermission(ctx.userId, ctx.organizationId, PermissionKey.channelsManage)

    const phoneNumberId = ctx.extra?.phoneNumberId
    if (typeof phoneNumberId !== 'string' || !phoneNumberId) {
      throw new BadRequestError('Pick a Quo phone number to connect as a channel.')
    }

    const { integrationId } = await provisionQuoChannel({
      credentialId: ctx.credentialId,
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      phoneNumberId,
      inboxId: ctx.extra?.inboxId as string | undefined,
    })

    logger.info('Quo (OpenPhone) connection provisioned', { integrationId, phoneNumberId })
  },
}
