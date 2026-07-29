// packages/lib/src/channels/personal-connection.ts

import { database as db, schema } from '@auxx/database'
import type { IntegrationProviderType } from '@auxx/database/enums'
import { ResourceGranteeType, ResourcePermission } from '@auxx/database/enums'
import { createScopedLogger } from '@auxx/logger'
import { toRecordId } from '@auxx/types/resource'
import { and, eq, isNull } from 'drizzle-orm'
import { getOrgCache, onCacheEvent } from '../cache'
import { clearImportCache } from '../email/polling-import-cache'
import { ForbiddenError, NotFoundError } from '../errors'
import { buildDefFieldIdMap, moveInboxInstance, rekeyInboxGrants } from '../inboxes/inbox-def-move'
import { setInboxFloor } from '../inboxes/inbox-floor'
import { InboxService } from '../inboxes/inbox-service'
import { enqueueStorageCleanupJob } from '../jobs/maintenance/storage-cleanup-job'
import { GoogleOAuthService } from '../providers/google/google-oauth'
import { OutlookOAuthService } from '../providers/outlook/outlook-oauth'
import { PROVIDER_CAPABILITIES } from '../providers/provider-capabilities'
import { setInstanceAccess } from '../resource-access/resource-access-service'
import { loadExistingState } from '../seed/entity-migrations/helpers'
import { CHANNEL_PROVIDER_TO_KEY } from './channel-connection-def'
import { deleteChannelData, disconnect } from './disconnect'

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
 * named after the address, owner stamped, owner as Manager. Nothing attaches to
 * the org's Shared Inbox.
 *
 * **The mailbox is created on the `personal_inbox` DEFINITION** (plan 40 §3.2 /
 * 40a §3). That is the whole point of the def split: privacy is now unforgeable
 * def membership rather than an `inbox_is_personal` FieldValue defended by a
 * write-wall pre-hook, and `personal_inbox` is the `baselineAtCreate: true`
 * instance-access key, so "no row ⇒ no access" holds for every member including
 * the org owner. Consequently neither `isPersonal` nor `defaultLens` is passed:
 * the def implies both, and neither field even exists on it (40a §1.2). A
 * personal mailbox never gets a `role:org_member` floor row.
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
    entityDefinitionKey: 'personal_inbox',
    ownerUserId,
  })

  // Owner becomes the inbox Manager (createInbox only grants when the
  // service carries a user — the system-scoped one doesn't).
  //
  // `inbox.recordId` is minted from the definition the instance actually landed
  // on, so this row is keyed `personal_inbox` without the call site having to
  // know that — which is what keeps it in the same keyspace
  // `composeUserMailVisibility` and `hasPermission` read it back from.
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

/**
 * Assert the inbox is personal and its owner is no longer an org member.
 *
 * The personal test is **def membership**, not `Inbox.isPersonal` (40a §3). The
 * derived flag is still `personal_inbox` def OR the legacy `inbox_is_personal`
 * marker, and the two disagree by design for the whole window between entity
 * migration 059 and data migration 060 — but neither of the two operations this
 * guard fronts can act on a marker-only mailbox: `claimPersonalInbox` is a
 * cross-def MOVE (there is nothing to move a shared-def instance off) and
 * `deletePersonalInbox` destroys threads on the strength of "this data was never
 * org-visible", which only def membership proves. Refusing is the fail-closed
 * answer, and 060 runs in the same deploy as this code.
 */
async function loadOrphanedPersonalInbox(
  inboxService: InboxService,
  organizationId: string,
  inboxId: string
) {
  const inbox = await inboxService.getInboxById(inboxId)
  if (!inbox) throw new NotFoundError('Inbox not found')
  if (inbox.entityDefinitionKey !== 'personal_inbox') {
    throw new ForbiddenError('Not a personal inbox')
  }

  const roleMap = await getOrgCache().get(organizationId, 'memberRoleMap')
  if (inbox.ownerUserId && roleMap[inbox.ownerUserId]?.role) {
    throw new ForbiddenError(
      "This personal inbox's owner is still a member — it can only be claimed or deleted after they leave"
    )
  }
  return inbox
}

/**
 * Offboarding step 2a (§11.4): CLAIM an orphaned personal inbox — converting it
 * into a normal RESTRICTED org inbox.
 *
 * **Since the def split this is a cross-def MOVE, not a marker flip** (plan 40
 * §3.2 / 40a §3). Personal-ness is def membership, so "this is no longer a
 * personal mailbox" can only be said by moving the instance onto the shared
 * `inbox` definition — which drags three things with it, all of which the
 * mechanism in `inboxes/inbox-def-move.ts` handles, and all of which are silent
 * failures if skipped:
 *
 *  1. `EntityInstance.entityDefinitionId` — the move itself.
 *  2. Every `FieldValue`'s `fieldId` **and** `entityDefinitionId`, remapped onto
 *     the shared def's own `CustomField` rows by `systemAttribute` (defs do not
 *     share field rows — 40a §6's "CLONE, not repoint"). A value left pointing
 *     at a `personal_inbox` CustomField reads back as absent, so the inbox would
 *     silently lose its name and colour. Nothing is dropped in this direction:
 *     the shared def's attribute set is a superset of the personal one's.
 *  3. Its `ResourceAccess` rows, re-keyed `personal_inbox` → `inbox`. Mail rows
 *     are matched by literal slug, so a row left behind is a Manager grant that
 *     stops being read.
 *
 * That mechanism is shared verbatim with data migration 060, which runs the same
 * move in the other direction in bulk — one implementation, so the collision
 * rule on `ResourceAccess`'s `nullsNotDistinct` unique index cannot drift.
 *
 * This path uses the SERVICE functions rather than the migration's bulk posture
 * because it is one user-initiated act on one mailbox: `updateInbox` runs the
 * field walls as the admin and broadcasts `inbox.updated`, and `setInboxFloor`
 * emits the mail/grant-index invalidations.
 *
 * The result is today's behaviour, expressed in v2's vocabulary: the floor stays
 * `none`, now written as the `role:org_member @ none` RESTRICTION row instead of
 * an `inbox_default_lens` FieldValue nothing reads. `inbox_owner_user_id` is
 * NULLED rather than deleted — the field exists on the shared def and an
 * ownerless inbox is exactly what a claimed one is.
 */
export async function claimPersonalInbox(args: {
  organizationId: string
  adminUserId: string
  inboxId: string
}): Promise<void> {
  const { organizationId, adminUserId, inboxId } = args
  const inboxService = new InboxService(db, organizationId, adminUserId)
  await loadOrphanedPersonalInbox(inboxService, organizationId, inboxId)

  // ONE query for BOTH defs — `ExistingState` is keyed by entityType for defs
  // and `${entityDefinitionId}:${systemAttribute}` for fields, so the target
  // def's id and its materialized CustomField ids both fall out of it.
  const state = await loadExistingState(db, organizationId)
  const sharedDefId = state.entityDefs.get('inbox')?.id
  const personalDefId = state.entityDefs.get('personal_inbox')?.id
  if (!sharedDefId || !personalDefId) {
    throw new NotFoundError('Inbox definitions are not seeded for this organization')
  }

  const moved = await moveInboxInstance(db, {
    instanceId: inboxId,
    fromDefId: personalDefId,
    toDefId: sharedDefId,
    newFieldIdByAttr: buildDefFieldIdMap(state.fields, sharedDefId),
  })
  for (const value of moved.unmapped) {
    logger.warn('FieldValue has no inbox counterpart — left on the personal def', {
      organizationId,
      inboxId,
      fieldValueId: value.id,
      systemAttribute: value.systemAttribute,
    })
  }

  const grants = await rekeyInboxGrants(db, {
    organizationId,
    instanceId: inboxId,
    fromKey: 'personal_inbox',
    toKey: 'inbox',
  })

  const claimedRecordId = toRecordId('inbox', inboxId)

  // Floor `none` — a claimed mailbox is a RESTRICTED org inbox, reachable only
  // by its explicit grantees. Written before the owner is cleared so there is no
  // window in which the instance is shared-def with no baseline row (which the
  // area fallback would read as `full` for every member).
  await setInboxFloor({ db, organizationId, userId: adminUserId }, claimedRecordId, 'none')

  // Nulled, not dropped: the shared def carries `inbox_owner_user_id`, and this
  // write also broadcasts `inbox.updated` so every member's `userMailVisibility`
  // and the `org:inboxes` shape recompute off the instance's new definition.
  await inboxService.updateInbox(claimedRecordId, { ownerUserId: null })

  logger.info('Personal inbox claimed', {
    inboxId,
    adminUserId,
    valuesRemapped: moved.valuesRemapped,
    ...grants,
  })
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

/**
 * Delete YOUR OWN personal inbox — the member-facing sibling of
 * {@link deletePersonalInbox}, which is the ADMIN path and only ever fires once
 * the owner has left the org.
 *
 * **Deleting the mailbox disconnects its account**, deliberately. A personal
 * inbox is a one-account container: it exists only because a member connected a
 * personal channel, nothing else may ever route into it
 * (`assertSharedConnectInbox` and `addIntegration` both reject one as a target),
 * and no other member can see it. So "delete my inbox" and "disconnect my
 * account" are the same act — and if they weren't, `deleteInbox`'s
 * active-channel guard would refuse and leave the member holding a mailbox they
 * have no way to remove. That was the state before this existed: `disconnect`
 * destroys the threads and soft-deletes the `Integration` but never touches the
 * inbox instance, so an empty personal inbox outlived every account it ever had.
 *
 * **Authority is OWNERSHIP, not a grant.** `inbox_owner_user_id` is admin-only
 * data no member can write, whereas a `personal_inbox` `admin` `ResourceAccess`
 * row is something the owner can hand out by sharing — so `canManageInboxAccess`
 * would let a Manager grantee destroy the owner's mail. Nor does this open an
 * admin door: `channels.manage` deletes SHARED inbox inventory, and a current
 * member's private mailbox is only reachable through the orphan path above.
 *
 * Reuses `disconnect` per channel — provider revoke, threads/messages/attachment
 * assets, `Integration` soft-delete, polling cache, mail-count epoch, S3 cleanup
 * — rather than {@link deletePersonalInbox}'s open-coded bulk posture, which
 * exists because offboarding has ALREADY soft-deleted those integrations and
 * `disconnect`'s `validateChannelOwnership` would no longer find them.
 */
export async function deleteOwnPersonalInbox(args: {
  organizationId: string
  userId: string
  inboxId: string
}): Promise<void> {
  const { organizationId, userId, inboxId } = args
  const inboxService = new InboxService(db, organizationId, userId)

  const inbox = await inboxService.getInboxById(inboxId)
  if (!inbox) throw new NotFoundError('Inbox not found')
  if (inbox.entityDefinitionKey !== 'personal_inbox') {
    throw new ForbiddenError('Not a personal inbox')
  }
  if (!inbox.ownerUserId || inbox.ownerUserId !== userId) {
    throw new ForbiddenError('Only the owner of a personal inbox can delete it')
  }

  const links = await db.query.InboxIntegration.findMany({
    where: eq(schema.InboxIntegration.inboxId, inboxId),
  })
  for (const link of links) {
    // Already soft-deleted (an offboarding half-run, a prior disconnect) reads
    // as NotFound — there is nothing left to revoke and the link row dies with
    // the inbox below, so this must not abort the delete.
    const result = await disconnect({ db, organizationId, userId }, link.integrationId)
    if (!result.ok) {
      logger.warn('Personal channel already gone, continuing inbox delete', {
        inboxId,
        integrationId: link.integrationId,
      })
    }
  }

  await inboxService.deleteInbox(inbox.recordId)

  // `deleteInbox` broadcasts `inbox.deleted` + `channel.inbox-link.changed`;
  // the channel INVENTORY change is this path's own (the disconnect router
  // fires the same event beside its own `disconnect` call).
  if (links.length > 0) {
    await onCacheEvent('channel.disconnected', { orgId: organizationId })
  }

  logger.info('Personal inbox deleted by its owner', {
    inboxId,
    userId,
    channels: links.length,
  })
}
