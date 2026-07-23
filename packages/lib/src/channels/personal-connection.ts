// packages/lib/src/channels/personal-connection.ts

import { database as db, schema } from '@auxx/database'
import type { IntegrationProviderType } from '@auxx/database/enums'
import { ResourceGranteeType, ResourcePermission } from '@auxx/database/enums'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, isNull } from 'drizzle-orm'
import { getOrgCache, onCacheEvent } from '../cache'
import { clearImportCache } from '../email/polling-import-cache'
import { ForbiddenError, NotFoundError } from '../errors'
import { InboxService } from '../inboxes/inbox-service'
import { enqueueStorageCleanupJob } from '../jobs/maintenance/storage-cleanup-job'
import { GoogleOAuthService } from '../providers/google/google-oauth'
import { OutlookOAuthService } from '../providers/outlook/outlook-oauth'
import { PROVIDER_CAPABILITIES } from '../providers/provider-capabilities'
import { setInstanceAccess } from '../resource-access/resource-access-service'
import { CHANNEL_PROVIDER_TO_KEY } from './channel-connection-def'
import { deleteChannelData } from './disconnect'

const logger = createScopedLogger('personal-connection')

/** ConnectionDefinition.providerKey → ChannelProviderType (inverse of CHANNEL_PROVIDER_TO_KEY). */
const CHANNEL_PROVIDER_BY_KEY: Record<string, IntegrationProviderType> = Object.fromEntries(
  Object.entries(CHANNEL_PROVIDER_TO_KEY).map(([provider, key]) => [
    key,
    provider as IntegrationProviderType,
  ])
)

/**
 * Whether a connection providerKey may mint a PERSONAL (user-scoped) channel
 * credential (mail-permissions §11.1). The OAuth authorize route enforces
 * this server-side — the wizard step is just ergonomics. Fail closed: keys
 * that don't map to a channel provider, or map to one without the
 * `supportsPersonalConnection` capability, return false.
 */
export function supportsPersonalChannelConnection(providerKey: string | null): boolean {
  if (!providerKey) return false
  const provider = CHANNEL_PROVIDER_BY_KEY[providerKey]
  if (!provider) return false
  return PROVIDER_CAPABILITIES[provider]?.supportsPersonalConnection === true
}

/**
 * Provision the dedicated inbox for a PERSONAL channel connect (§11.1):
 * named after the address, `isPersonal` + owner stamped, floor `none`
 * (the §11.3 carve-out — no enterprise key needed on this system path),
 * owner as Manager. Nothing attaches to the org's Shared Inbox.
 *
 * Reconnect of the user's own personal channel is a no-op; a mailbox already
 * linked to a shared inbox (or another user's personal inbox) is rejected —
 * `addIntegration` MOVES links, and silently rerouting an org channel's new
 * mail into a hidden inbox must never happen (fail closed).
 */
export async function provisionPersonalInbox(args: {
  organizationId: string
  ownerUserId: string
  integrationId: string
  email: string
}): Promise<void> {
  const { organizationId, ownerUserId, integrationId, email } = args

  // System-scoped service: userId-less writes pass the inbox field walls,
  // which is exactly the trusted-provisioning carve-out they encode.
  const inboxService = new InboxService(db, organizationId)

  const existingLink = await db.query.InboxIntegration.findFirst({
    where: eq(schema.InboxIntegration.integrationId, integrationId),
  })
  if (existingLink) {
    const linkedInbox = await inboxService.getInboxById(existingLink.inboxId)
    if (linkedInbox?.isPersonal && linkedInbox.ownerUserId === ownerUserId) {
      logger.info('Personal channel reconnect — inbox already provisioned', {
        integrationId,
        inboxId: existingLink.inboxId,
      })
      return
    }
    throw new Error(
      'This mailbox is already connected as a shared channel. Disconnect it first to connect it as a personal account.'
    )
  }

  const inbox = await inboxService.createInbox({
    name: email,
    defaultLens: 'none',
    isPersonal: true,
    ownerUserId,
  })

  // Owner becomes the inbox Manager (createInbox only grants when the
  // service carries a user — the system-scoped one doesn't).
  await setInstanceAccess(
    { db, organizationId, userId: ownerUserId },
    inbox.recordId,
    ResourceGranteeType.user,
    [{ granteeId: ownerUserId, permission: ResourcePermission.admin }]
  )

  await inboxService.addIntegration(inbox.recordId, integrationId, true)

  logger.info('Personal inbox provisioned', {
    inboxId: inbox.id,
    integrationId,
    ownerUserId,
  })
}

/**
 * Offboarding step 1 (§11.4): stop sync on the removed member's personal
 * channels WITHOUT deleting data — revoke provider access (best effort,
 * it is their credential), soft-delete the Integration rows, clear polling
 * caches. The inbox and its threads keep personal visibility; admins later
 * claim or delete the orphaned inbox. NOT `disconnect()` — that destroys
 * threads/messages, which would preempt the admin's claim-or-delete choice.
 */
export async function disconnectPersonalChannelsForUser(
  organizationId: string,
  userId: string
): Promise<number> {
  const rows = await db
    .select({ id: schema.Integration.id, provider: schema.Integration.provider })
    .from(schema.Integration)
    .innerJoin(schema.Credential, eq(schema.Integration.credentialId, schema.Credential.id))
    .where(
      and(
        eq(schema.Integration.organizationId, organizationId),
        isNull(schema.Integration.deletedAt),
        eq(schema.Credential.userId, userId)
      )
    )

  for (const row of rows) {
    try {
      if (row.provider === 'google') await GoogleOAuthService.revokeAccess(row.id)
      else if (row.provider === 'outlook') await OutlookOAuthService.revokeAccess(row.id)
    } catch (error) {
      logger.warn('Failed to revoke personal channel access, continuing disconnect', {
        integrationId: row.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }

    await db
      .update(schema.Integration)
      .set({ deletedAt: new Date(), enabled: false, updatedAt: new Date() })
      .where(eq(schema.Integration.id, row.id))
    await clearImportCache(row.id)
  }

  if (rows.length > 0) {
    await onCacheEvent('channel.disconnected', { orgId: organizationId })
    logger.info('Disconnected personal channels for removed member', {
      organizationId,
      userId,
      count: rows.length,
    })
  }
  return rows.length
}

/** Assert the inbox is personal and its owner is no longer an org member. */
async function loadOrphanedPersonalInbox(
  inboxService: InboxService,
  organizationId: string,
  inboxId: string
) {
  const inbox = await inboxService.getInboxById(inboxId)
  if (!inbox) throw new NotFoundError('Inbox not found')
  if (!inbox.isPersonal) throw new ForbiddenError('Not a personal inbox')

  const roleMap = await getOrgCache().get(organizationId, 'memberRoleMap')
  if (inbox.ownerUserId && roleMap[inbox.ownerUserId]?.role) {
    throw new ForbiddenError(
      "This personal inbox's owner is still a member — it can only be claimed or deleted after they leave"
    )
  }
  return inbox
}

/**
 * Offboarding step 2a (§11.4): CLAIM an orphaned personal inbox — clear the
 * personal marker + owner, converting it into a normal restricted org inbox
 * (floor stays `none`; the admin short-circuit applies from then on). The
 * inbox field write runs as the admin, so the field walls stay honest, and
 * `inbox.updated` broadcasts every member's visibility recompute.
 */
export async function claimPersonalInbox(args: {
  organizationId: string
  adminUserId: string
  inboxId: string
}): Promise<void> {
  const { organizationId, adminUserId, inboxId } = args
  const inboxService = new InboxService(db, organizationId, adminUserId)
  const inbox = await loadOrphanedPersonalInbox(inboxService, organizationId, inboxId)

  await inboxService.updateInbox(inbox.recordId, { isPersonal: false, ownerUserId: null })

  logger.info('Personal inbox claimed', { inboxId, adminUserId })
}

/**
 * Offboarding step 2b (§11.4): DELETE an orphaned personal inbox — destroys
 * its channels' threads/messages (the data was never org-visible), then the
 * inbox itself (links + grants + instance via `deleteInbox`).
 */
export async function deletePersonalInbox(args: {
  organizationId: string
  adminUserId: string
  inboxId: string
}): Promise<void> {
  const { organizationId, adminUserId, inboxId } = args
  const inboxService = new InboxService(db, organizationId, adminUserId)
  const inbox = await loadOrphanedPersonalInbox(inboxService, organizationId, inboxId)

  const links = await db.query.InboxIntegration.findMany({
    where: eq(schema.InboxIntegration.inboxId, inboxId),
  })
  for (const link of links) {
    const [integration] = await db
      .select({ id: schema.Integration.id, provider: schema.Integration.provider })
      .from(schema.Integration)
      .where(eq(schema.Integration.id, link.integrationId))
      .limit(1)
    if (!integration) continue

    await db.transaction(async (tx) => {
      await deleteChannelData(tx, integration.id, integration.provider)
      await tx
        .update(schema.Integration)
        .set({ deletedAt: new Date(), enabled: false, updatedAt: new Date() })
        .where(eq(schema.Integration.id, integration.id))
    })
    await clearImportCache(integration.id)
    await enqueueStorageCleanupJob({
      type: 'integration',
      organizationId,
      integrationId: integration.id,
    })
  }

  await inboxService.deleteInbox(inbox.recordId)

  const { bumpMailCountsEpoch } = await import('../threads/mail-counts')
  await bumpMailCountsEpoch(organizationId)

  logger.info('Personal inbox deleted', { inboxId, adminUserId, channels: links.length })
}
