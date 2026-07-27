// packages/lib/src/channels/openphone-provisioning-hook.ts
// Post-connect provisioning for the Quo (OpenPhone) SMS channel — a secret (API-key) connection.
// The generic `connections.save` path commits a Credential holding the apiKey + webhookSigningSecret
// (both encrypted) plus the non-secret routing identity (phoneNumberId, phoneNumber) under
// metadata.connectionVariables, then runs this hook to do the channel-side provisioning that used to
// live in OpenPhoneService.addIntegration:
//   gate (admin + channel limit), create-or-relink the Integration row matched by phoneNumberId, copy
//   the two non-secret identifiers onto Integration.metadata (the shape the provider + webhook route
//   read), default selective record-creation, and link the default inbox.
//
// Secrets stay on the Credential: getChannelTokens resolves apiKey via Integration.credentialId, and the
// unauthenticated webhook route reveals webhookSigningSecret via the same credentialId — neither is
// copied into Integration.metadata. There is no token swap (unlike the social hook) — saveConnection
// already stored apiKey as the credential secret.

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import { onCacheEvent } from '../cache'
import type { PostConnectHook, PostConnectHookContext } from '../connections/post-connect-hooks'
import { ForbiddenError } from '../errors'
import { publisher } from '../events'
import { InboxService } from '../inboxes/inbox-service'
import {
  FeatureKey,
  FeaturePermissionService,
  PermissionKey,
  requirePermission,
} from '../permissions'
import { assertSharedConnectInbox } from './connect-inbox'
import { countBillableChannels } from './list'

const logger = createScopedLogger('openphone-provisioning-hook')

/** The non-secret routing identity carried in Credential metadata.connectionVariables. */
interface OpenPhoneIdentity {
  phoneNumberId: string
  phoneNumber: string
}

/** Read the saved connection's non-secret connection variables from the Credential row. */
async function readIdentity(
  credentialId: string,
  organizationId: string
): Promise<OpenPhoneIdentity> {
  const [credential] = await db
    .select({ metadata: schema.Credential.metadata })
    .from(schema.Credential)
    .where(
      and(
        eq(schema.Credential.id, credentialId),
        eq(schema.Credential.organizationId, organizationId)
      )
    )
    .limit(1)
  const vars = (credential?.metadata?.connectionVariables ?? {}) as Record<string, unknown>
  const phoneNumberId = typeof vars.phoneNumberId === 'string' ? vars.phoneNumberId : ''
  const phoneNumber = typeof vars.phoneNumber === 'string' ? vars.phoneNumber : ''
  if (!phoneNumberId || !phoneNumber) {
    throw new Error('Quo connection is missing phoneNumberId / phoneNumber')
  }
  return { phoneNumberId, phoneNumber }
}

/** Enforce the channel feature limit (the bespoke addOpenPhoneIntegration ran this pre-insert). */
async function assertChannelLimit(organizationId: string): Promise<void> {
  const limit = await new FeaturePermissionService(db).getLimit(organizationId, FeatureKey.channels)
  if (typeof limit === 'number' && limit >= 0) {
    const current = await countBillableChannels(db, organizationId)
    if (current >= limit) {
      throw new ForbiddenError(
        `You have reached your channel limit (${limit}). Upgrade your plan to connect more channels.`
      )
    }
  }
}

/** Find the existing openphone Integration for this phone number id, if any (jsonb match in memory). */
async function findExistingChannel(
  organizationId: string,
  phoneNumberId: string
): Promise<string | null> {
  const rows = await db
    .select({ id: schema.Integration.id, metadata: schema.Integration.metadata })
    .from(schema.Integration)
    .where(
      and(
        eq(schema.Integration.organizationId, organizationId),
        eq(schema.Integration.provider, 'openphone')
      )
    )
  const match = rows.find(
    (r) => (r.metadata as Record<string, unknown> | null)?.phoneNumberId === phoneNumberId
  )
  return match?.id ?? null
}

/** The Quo (OpenPhone) channel post-connect hook — runs off the secret-save path. */
export const openphoneProvisioningHook: PostConnectHook = {
  providerKeys: ['openphone'],
  async run(ctx: PostConnectHookContext): Promise<void> {
    // Channels require the channels.manage capability (the generic secret-save allows any member).
    await requirePermission(ctx.userId, ctx.organizationId, PermissionKey.channelsManage)

    const identity = await readIdentity(ctx.credentialId, ctx.organizationId)
    const existingId = await findExistingChannel(ctx.organizationId, identity.phoneNumberId)
    // Only a brand-new channel counts against the limit; a reconnect relinks in place.
    if (!existingId) await assertChannelLimit(ctx.organizationId)

    const metadata = { phoneNumberId: identity.phoneNumberId, phoneNumber: identity.phoneNumber }
    let integrationId: string

    if (existingId) {
      await db
        .update(schema.Integration)
        .set({
          credentialId: ctx.credentialId,
          enabled: true,
          metadata: metadata as any,
          updatedAt: new Date(),
        })
        .where(eq(schema.Integration.id, existingId))
      integrationId = existingId
    } else {
      const [created] = await db
        .insert(schema.Integration)
        .values({
          organizationId: ctx.organizationId,
          provider: 'openphone',
          credentialId: ctx.credentialId,
          enabled: true,
          metadata: metadata as any,
          messageType: 'SMS',
          // Default to selective record-creation on first connect (matches the bespoke service).
          settings: { recordCreation: { mode: 'selective' } } as any,
          updatedAt: new Date(),
        })
        .returning({ id: schema.Integration.id })
      integrationId = created!.id
    }

    // Inbox-first (channels v2): a new channel REQUIRES a validated shared inbox chosen
    // up-front (forwarded via `pc_inboxId` → `ctx.extra.inboxId`); a reconnect keeps its
    // existing link and ignores the param.
    const existingLink = existingId
      ? await db.query.InboxIntegration.findFirst({
          where: eq(schema.InboxIntegration.integrationId, integrationId),
        })
      : null
    if (!existingLink) {
      const recordId = await assertSharedConnectInbox(
        db,
        ctx.organizationId,
        ctx.extra?.inboxId as string | undefined
      )
      const inboxService = new InboxService(db, ctx.organizationId, ctx.userId)
      await inboxService.addIntegration(recordId, integrationId)
    }

    await onCacheEvent('channel.connected', { orgId: ctx.organizationId })

    await publisher.publishLater({
      type: 'integration:connected',
      data: {
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        provider: 'openphone',
        identifier: identity.phoneNumber,
        integrationId,
      },
    })

    logger.info('Quo (OpenPhone) channel provisioned', {
      integrationId,
      phoneNumberId: identity.phoneNumberId,
      isNew: !existingId,
    })
  },
}
