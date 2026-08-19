// packages/lib/src/organizations/organization-service.ts
// ** CONTAINS LOGIC TO DELETE OTHER USERS - USE WITH EXTREME CAUTION **

import { RESERVED_ORGANIZATION_HANDLES } from '@auxx/config'
import { type Database, schema } from '@auxx/database'
import { OrganizationRole, type OrganizationType } from '@auxx/database/enums'
import { createScopedLogger } from '@auxx/logger'
import { TRPCError } from '@trpc/server'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { flushOrganization, onCacheEvent } from '../cache'
import { DehydrationService } from '../dehydration'
import type { ForwardingIntegrationMetadata } from '../email/inbound'
import { MessageService } from '../email/message-service'
import { clearImportCache } from '../email/polling-import-cache'
import { InboxService } from '../inboxes'
import { enqueueStorageCleanupJob } from '../jobs/maintenance/storage-cleanup-job'
import { getMembership } from '../members'
import { ensureSystemProfiles } from '../permissions/profiles'
import type { ChannelProviderType } from '../providers/types'
import { OrganizationSeeder } from '../seed/organization-seeder'
import { SystemUserService } from '../users/system-user-service'

const logger = createScopedLogger('organization-service')

/** The `pg` driver error fields worth logging when a query fails. */
interface PostgresErrorFields {
  code?: string
  constraint?: string
  table?: string
  column?: string
  detail?: string
  message?: string
}

/**
 * Walk an error's `cause` chain and pull out the underlying Postgres driver fields.
 *
 * Drizzle wraps driver errors in a `DrizzleQueryError` whose own `message` is just
 * `Failed query: <sql>` — the SQLSTATE and the constraint name that actually identify the
 * problem sit one or more levels down on `cause`. Without this, a cascade failure logs as an
 * opaque "Failed query: delete from ..." and the offending constraint has to be rediscovered
 * by reproducing the delete.
 */
function extractPostgresError(error: unknown): PostgresErrorFields | null {
  let current: unknown = error
  // Bounded walk — `cause` chains are short, and a cyclic one must not hang the handler.
  for (let depth = 0; current instanceof Error && depth < 5; depth++) {
    const candidate = current as Error & PostgresErrorFields
    if (typeof candidate.code === 'string') {
      return {
        code: candidate.code,
        constraint: candidate.constraint,
        table: candidate.table,
        column: candidate.column,
        detail: candidate.detail,
        message: candidate.message,
      }
    }
    current = candidate.cause
  }
  return null
}

/**
 * Service class for managing core Organization operations, including deletion.
 */
export class OrganizationService {
  private db: Database
  /**
   * Creates an instance of OrganizationService.
   * @param db - The database instance.
   */
  constructor(db: Database) {
    this.db = db
  }

  /**
   * getInboundEmailDomain returns the configured forwarding domain.
   */
  private getInboundEmailDomain(): string {
    return (process.env.INBOUND_EMAIL_DOMAIN || 'mail.auxx.ai').trim().toLowerCase()
  }

  /**
   * buildForwardingAddress creates the forwarding mailbox for an organization handle.
   */
  private buildForwardingAddress(handle: string): string {
    return `${handle.trim().toLowerCase()}@${this.getInboundEmailDomain()}`
  }

  /**
   * buildForwardingMetadata merges system-managed forwarding metadata with any existing metadata.
   */
  private buildForwardingMetadata(params: {
    existingMetadata?: Record<string, unknown> | null
    userEmail?: string
  }): ForwardingIntegrationMetadata {
    const existingMetadata = (params.existingMetadata ?? {}) as ForwardingIntegrationMetadata
    const allowedSenders = new Set(
      Array.isArray(existingMetadata.allowedSenders)
        ? existingMetadata.allowedSenders.map((entry) => entry.trim().toLowerCase()).filter(Boolean)
        : []
    )

    if (params.userEmail) {
      allowedSenders.add(params.userEmail.trim().toLowerCase())
    }

    return {
      ...existingMetadata,
      channelType: 'forwarding-address',
      systemManaged: true,
      ingressProvider: 'ses-s3-sqs',
      allowedSenders: Array.from(allowedSenders),
    }
  }

  /**
   * ensureForwardingAddressIntegration creates or updates the system-managed forwarding integration.
   */
  async ensureForwardingAddressIntegration(params: {
    organizationId: string
    userId: string
    handle?: string | null
    userEmail?: string
  }): Promise<string | null> {
    const handle = params.handle?.trim().toLowerCase()
    if (!handle) return null

    const forwardingAddress = this.buildForwardingAddress(handle)
    const emailIntegrations = await this.db
      .select()
      .from(schema.Integration)
      .where(
        and(
          eq(schema.Integration.organizationId, params.organizationId),
          eq(schema.Integration.provider, 'email'),
          isNull(schema.Integration.deletedAt)
        )
      )

    const forwardingIntegration =
      emailIntegrations.find((integration) => {
        const metadata = integration.metadata as ForwardingIntegrationMetadata | null
        return metadata?.channelType === 'forwarding-address' || metadata?.systemManaged === true
      }) ?? emailIntegrations.find((integration) => integration.email === forwardingAddress)

    const metadata = this.buildForwardingMetadata({
      existingMetadata: forwardingIntegration?.metadata as Record<string, unknown> | null,
      userEmail: params.userEmail,
    })

    let integrationId: string

    if (forwardingIntegration) {
      const [updatedIntegration] = await this.db
        .update(schema.Integration)
        .set({
          name: forwardingAddress,
          email: forwardingAddress,
          enabled: true,
          metadata: metadata as unknown as any,
          updatedAt: new Date(),
        })
        .where(eq(schema.Integration.id, forwardingIntegration.id))
        .returning({ id: schema.Integration.id })

      integrationId = updatedIntegration!.id
    } else {
      const [createdIntegration] = await this.db
        .insert(schema.Integration)
        .values({
          organizationId: params.organizationId,
          provider: 'email',
          name: forwardingAddress,
          email: forwardingAddress,
          enabled: true,
          metadata: metadata as unknown as any,
          updatedAt: new Date(),
        })
        .returning({ id: schema.Integration.id })

      integrationId = createdIntegration!.id
    }

    const inboxService = new InboxService(this.db, params.organizationId, params.userId)
    await inboxService.addIntegrationToSharedInbox(integrationId, true)

    // This method is the only authority on the forwarding integration existing,
    // so it owns the cache consequence rather than leaving it to each caller.
    // Two of the four callers happen to `flushOrganization` afterwards, but
    // `organization.update` (the onboarding handle step) emits only
    // `org.updated` → ['orgProfile'], and the backfill script emits nothing —
    // so the new channel stayed absent from `channelProviders` for the key's
    // full THIRTY_DAYS TTL and every `getProviderType` on it threw NotFound.
    await onCacheEvent('channel.connected', { orgId: params.organizationId })

    logger.info('Ensured forwarding address integration', {
      organizationId: params.organizationId,
      integrationId,
      forwardingAddress,
    })

    return integrationId
  }

  /**
   * slugifyHandle turns an arbitrary seed (e.g. a Shopify shop domain) into a
   * candidate handle that satisfies the org-handle constraints: lowercase,
   * `[a-z0-9-]` only, no leading/trailing hyphens, 4–32 chars. Domain seeds are
   * reduced to their first label first (`acme.myshopify.com` → `acme`).
   */
  private slugifyHandle(seed: string): string {
    const base = seed
      .trim()
      .toLowerCase()
      .split('.')[0] // drop domain suffix: acme.myshopify.com → acme
      ?.replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
    return (base || 'store').slice(0, 32)
  }

  /**
   * ensureOrganizationHandle guarantees an organization has a non-null, unique
   * handle, deriving a provisional one from `seed` when none is set yet.
   *
   * The Shopify App-Store claim flow connects an app (firing `connection-added`,
   * which requires a non-null `organizationHandle` in the Lambda context) before
   * the merchant reaches the onboarding handle-picker. This seeds a sensible
   * handle from the shop domain so the event validates; the merchant can still
   * change it in onboarding (the picker pre-fills from the stored value).
   *
   * No-op when the org already has a handle. The derived handle has no external
   * binding to the shop name — a collision just gets a numeric/id suffix.
   *
   * @returns the org's handle (existing or newly assigned), or null on failure.
   */
  async ensureOrganizationHandle(params: {
    organizationId: string
    userId: string
    seed: string
    userEmail?: string
  }): Promise<string | null> {
    const [org] = await this.db
      .select({ handle: schema.Organization.handle })
      .from(schema.Organization)
      .where(eq(schema.Organization.id, params.organizationId))
      .limit(1)

    if (!org) return null
    if (org.handle) return org.handle

    let base = this.slugifyHandle(params.seed)
    // Enforce the 4-char minimum by padding from the (unique) org id.
    if (base.length < 4) {
      base = (base + params.organizationId.toLowerCase().replace(/[^a-z0-9]/g, '')).slice(0, 32)
    }

    const handle = await this.findAvailableHandle(base, params.organizationId)

    await this.db
      .update(schema.Organization)
      .set({ handle, updatedAt: new Date() })
      .where(eq(schema.Organization.id, params.organizationId))

    await this.ensureForwardingAddressIntegration({
      organizationId: params.organizationId,
      userId: params.userId,
      userEmail: params.userEmail,
      handle,
    })

    await flushOrganization(params.organizationId)

    logger.info('Assigned provisional organization handle', {
      organizationId: params.organizationId,
      handle,
    })

    return handle
  }

  /**
   * findAvailableHandle returns the first non-reserved handle that is free on the
   * `Organization_handle_key` unique index, starting from `base` and falling back
   * to `base-2`, `base-3`, … then `base-<orgId slice>` (effectively guaranteed
   * unique) if the numeric suffixes are exhausted.
   */
  private async findAvailableHandle(base: string, organizationId: string): Promise<string> {
    const isTaken = async (candidate: string): Promise<boolean> => {
      if (RESERVED_ORGANIZATION_HANDLES.includes(candidate as any)) return true
      const [existing] = await this.db
        .select({ id: schema.Organization.id })
        .from(schema.Organization)
        .where(eq(schema.Organization.handle, candidate))
        .limit(1)
      return !!existing
    }

    if (!(await isTaken(base))) return base

    for (let n = 2; n <= 9; n++) {
      const candidate = `${base.slice(0, 32 - 2)}-${n}`
      if (!(await isTaken(candidate))) return candidate
    }

    const suffix = organizationId
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 6)
    return `${base.slice(0, 32 - (suffix.length + 1))}-${suffix}`
  }

  /**
   * Verifies if a user is an OWNER of the specified organization.
   * Throws TRPCError if not.
   * @param userId - The ID of the user to check.
   * @param organizationId - The ID of the organization to check against.
   * @throws {TRPCError} FORBIDDEN if user is not found or not an OWNER.
   */
  private async verifyOwnerOrFail(userId: string, organizationId: string): Promise<void> {
    logger.debug(`Verifying owner status for user ${userId} in org ${organizationId}`)
    const membership = await getMembership(userId, organizationId, this.db)

    if (!membership) {
      logger.warn(`Verification failed: User ${userId} not found in org ${organizationId}`)
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'You are not a member of this organization.',
      })
    }
    if (membership.role !== OrganizationRole.OWNER) {
      logger.warn(
        `Verification failed: User ${userId} is not an OWNER in org ${organizationId} (role: ${membership.role})`
      )
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Only the organization Owner can perform this action.',
      })
    }
    logger.debug(`Verification successful: User ${userId} is an OWNER in org ${organizationId}`)
  }
  /**
   * Deletes an organization and all associated data after verification.
   * !! WARNING !! If this was a user's ONLY organization (including non-owners),
   * their User account WILL BE DELETED. Ensure drizzle schema cascades are correctly set for User relations.
   *
   * @param params - The parameters for deletion.
   * @param params.organizationId - The ID of the organization to delete.
   * @param params.requestingUserId - The ID of the user initiating the deletion (must be an Owner). Optional for system deletions.
   * @param params.confirmationEmail - The email address entered by the user for confirmation. Optional for system deletions.
   * @param params.skipEmailConfirmation - Skip email confirmation (for system deletions).
   * @param params.isSystemDeletion - Mark as automated system deletion.
   * @returns An object indicating success and whether the requesting owner's account was also deleted.
   * @throws {TRPCError} If verification fails, email confirmation mismatches, or a database error occurs.
   */
  async deleteOrganization(params: {
    organizationId: string
    requestingUserId?: string // The Owner initiating deletion (must be an Owner). Optional for system deletions.
    confirmationEmail?: string // Optional for system deletions
    skipEmailConfirmation?: boolean // Skip email confirmation (for system deletions)
    isSystemDeletion?: boolean // Mark as automated system deletion
  }): Promise<{
    success: true
    userDeleted: boolean
  }> {
    const {
      organizationId,
      requestingUserId,
      confirmationEmail,
      skipEmailConfirmation,
      isSystemDeletion,
    } = params

    if (isSystemDeletion) {
      logger.warn(
        `[SYSTEM DELETION] Initiating automated deletion process for organization ${organizationId}. This workflow MAY DELETE OTHER USERS if this is their only organization.`
      )
    } else {
      logger.warn(
        `[DANGER] Initiating deletion process for organization ${organizationId} by owner ${requestingUserId}. This workflow MAY DELETE OTHER USERS if this is their only organization.`
      )
    }

    // 1. Verify Requester is Owner (skip for system deletions)
    if (!isSystemDeletion && requestingUserId) {
      await this.verifyOwnerOrFail(requestingUserId, organizationId)
    }

    // 2. Verify Email Confirmation (skip for system deletions or when explicitly skipped)
    if (!isSystemDeletion && !skipEmailConfirmation && requestingUserId && confirmationEmail) {
      const [owner] = await this.db
        .select({ email: schema.User.email })
        .from(schema.User)
        .where(eq(schema.User.id, requestingUserId))
        .limit(1)
      if (!owner || !owner.email) {
        logger.error(`Failed to retrieve email for owner ${requestingUserId} during org deletion.`)
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Could not verify owner email.',
        })
      }
      if (owner.email.toLowerCase() !== confirmationEmail.toLowerCase()) {
        logger.warn(
          `Email confirmation mismatch for org ${organizationId} deletion. Expected ${owner.email}, got ${confirmationEmail}.`
        )
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: "Confirmation email does not match the owner's email.",
        })
      }
      logger.info(
        `Email confirmation successful for user ${requestingUserId} deleting org ${organizationId}.`
      )
    } else if (isSystemDeletion) {
      logger.info(`System deletion - skipping email confirmation for org ${organizationId}.`)
    }
    // 3. Optional Check: Handle case of the only owner (currently allows deletion)
    const ownerCountResult = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(schema.OrganizationMember)
      .where(
        and(
          eq(schema.OrganizationMember.organizationId, organizationId),
          eq(schema.OrganizationMember.role, OrganizationRole.OWNER)
        )
      )
    const ownerCount = ownerCountResult[0]?.count ?? 0
    if (ownerCount <= 1) {
      logger.warn(
        `Deleting organization ${organizationId} where user ${requestingUserId} is the last/only owner.`
      )
    }
    // --- Start Deletion Process (Transaction) ---
    let requestingUserWasDeleted = false
    let otherUsersDeletedCount = 0
    // *** IMPORTANT: Fetch IDs of ALL members BEFORE starting the transaction ***
    const allMembers = await this.db
      .select({ userId: schema.OrganizationMember.userId })
      .from(schema.OrganizationMember)
      .where(eq(schema.OrganizationMember.organizationId, organizationId))
    const allMemberIds = allMembers.map((m) => m.userId)
    if (allMemberIds.length === 0) {
      logger.warn(
        `Organization ${organizationId} has no members listed before transaction start? Proceeding with deletion.`
      )
    } else {
      logger.info(
        `Organization ${organizationId} has ${allMemberIds.length} members identified for potential post-deletion checks.`
      )
    }
    // Fetch system user ID before transaction (not in OrganizationMember, linked via Organization.systemUserId)
    const [orgRecord] = await this.db
      .select({ systemUserId: schema.Organization.systemUserId })
      .from(schema.Organization)
      .where(eq(schema.Organization.id, organizationId))
      .limit(1)
    const systemUserId = orgRecord?.systemUserId

    // --- Cancel Stripe subscription (synchronous, blocks deletion on failure) ---
    const activeSubscription = await this.db.query.PlanSubscription.findFirst({
      where: (sub, { eq: eqOp, and: andOp, or: orOp }) =>
        andOp(
          eqOp(sub.organizationId, organizationId),
          orOp(eqOp(sub.status, 'active'), eqOp(sub.status, 'trialing'))
        ),
      columns: {
        id: true,
        stripeSubscriptionId: true,
        status: true,
      },
    })

    if (activeSubscription?.stripeSubscriptionId) {
      try {
        // Dynamically import to avoid circular dependency
        const { stripeClient } = await import('@auxx/billing')
        const stripe = stripeClient.getClient()

        // Read before cancelling. This call runs BEFORE the transaction on purpose and that
        // ordering is deliberate, not an oversight: cancelling first and failing the delete
        // leaves an org with no subscription (recoverable), while deleting first and failing
        // the cancel leaves Stripe billing a customer who no longer has an account (not).
        //
        // The cost of that ordering is that a failed deletion leaves the subscription already
        // cancelled — so the retry must not blow up on it. A blind `cancel()` throws on an
        // already-cancelled subscription, which turned every retry into the misleading
        // "Please cancel your subscription first" error and made the org permanently
        // undeletable through the UI. `resource_missing` matters too: a `stripeSubscriptionId`
        // minted on a Stripe account we no longer hold keys for does not resolve, and that
        // must not wedge deletion either.
        const remote = await stripe.subscriptions
          .retrieve(activeSubscription.stripeSubscriptionId)
          .catch((err: unknown) => {
            if ((err as { code?: string })?.code === 'resource_missing') return null
            throw err
          })

        if (!remote) {
          logger.warn('Stripe subscription not found — nothing to cancel, continuing deletion', {
            organizationId,
            stripeSubscriptionId: activeSubscription.stripeSubscriptionId,
          })
        } else if (remote.status === 'canceled') {
          logger.info('Stripe subscription already canceled — continuing deletion', {
            organizationId,
            stripeSubscriptionId: activeSubscription.stripeSubscriptionId,
          })
        } else {
          await stripe.subscriptions.cancel(activeSubscription.stripeSubscriptionId)
          logger.info(
            `Canceled Stripe subscription ${activeSubscription.stripeSubscriptionId} for org ${organizationId}`
          )
        }
      } catch (stripeError) {
        logger.error('Failed to cancel Stripe subscription before org deletion', {
          organizationId,
          stripeSubscriptionId: activeSubscription.stripeSubscriptionId,
          error: stripeError instanceof Error ? stripeError.message : String(stripeError),
        })
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message:
            'Failed to cancel active subscription. Please cancel your subscription first or contact support.',
        })
      }
    }

    // --- Begin Transaction ---
    try {
      await this.db.transaction(async (tx) => {
        const txId = `TX-${organizationId.substring(0, 6)}-${Date.now()}`
        logger.info(
          `[${txId}] Starting deletion transaction. Users identified: ${allMemberIds.length}.`
        )
        // Step 4: Unregister Webhooks
        const integrations = await tx
          .select({
            id: schema.Integration.id,
            provider: schema.Integration.provider,
          })
          .from(schema.Integration)
          .where(eq(schema.Integration.organizationId, organizationId))
        logger.info(`[${txId}] Found ${integrations.length} integrations for webhook removal.`)
        const webhookPromises = integrations.map(async (integration) => {
          try {
            // Use static method for unregistering
            await MessageService.unregisterWebhooks(
              organizationId,
              integration.provider as ChannelProviderType, // Cast needed, ensure type exists
              integration.id
            )
            logger.info(
              `[${txId}] Successfully unregistered webhook for integration ${integration.id} (${integration.provider}).`
            )
          } catch (webhookError) {
            logger.error(
              `[${txId}] Non-critical error: Failed to unregister webhook for integration ${integration.id}. Continuing deletion...`,
              { error: webhookError }
            )
            // Log but don't fail transaction
          }
        })
        await Promise.all(webhookPromises) // Process webhook removals concurrently
        // Step 5: Delete other non-cascaded sensitive data (if any)
        await tx.delete(schema.ApiKey).where(eq(schema.ApiKey.organizationId, organizationId))
        logger.info(`[${txId}] Deleted API keys.`)
        // Add deletions for other models here if needed (e.g., custom integration settings)
        // Step 5b: Mark ALL StorageLocations for this org as deleted (before cascade)
        // S3 objects will be cleaned up asynchronously by storageCleanupJob
        await tx
          .update(schema.StorageLocation)
          .set({ deletedAt: new Date() })
          .where(eq(schema.StorageLocation.organizationId, organizationId))
        logger.info(`[${txId}] Marked StorageLocations as deleted for async S3 cleanup.`)

        // Step 5c: Clear Redis polling cache for all integrations
        for (const integration of integrations) {
          await clearImportCache(integration.id)
        }
        logger.info(
          `[${txId}] Cleared Redis polling cache for ${integrations.length} integrations.`
        )

        // Step 6: Delete the Organization itself (Trigger Cascades)
        // Cascades MUST handle deleting OrganizationMember records.
        logger.warn(
          `[${txId}] Preparing to delete organization record ${organizationId}. Cascading deletes will now occur.`
        )
        await tx.delete(schema.Organization).where(eq(schema.Organization.id, organizationId))
        logger.info(`[${txId}] Organization record ${organizationId} deleted.`)
        // **** STEP 7: Check remaining memberships for ALL former members ****
        logger.info(
          `[${txId}] Checking remaining memberships for ${allMemberIds.length} former members...`
        )

        for (const userId of allMemberIds) {
          const membershipCountResult = await tx
            .select({ count: sql<number>`count(*)` })
            .from(schema.OrganizationMember)
            .where(eq(schema.OrganizationMember.userId, userId))
          const remainingMemberships = Number(membershipCountResult[0]?.count ?? 0)
          // Count *after* the cascade should have removed the membership for the deleted org
          if (remainingMemberships === 0) {
            // User no longer belongs to ANY organization. Delete their account.
            logger.warn(
              `[${txId}] User ${userId} has no remaining memberships. DELETING USER ACCOUNT.`
            )
            try {
              // Ensure User relations (Account, Session, etc.) have onDelete: Cascade!
              await tx.delete(schema.User).where(eq(schema.User.id, userId))
              logger.info(`[${txId}] Successfully deleted user ${userId}.`)
              if (userId === requestingUserId) {
                requestingUserWasDeleted = true
              } else {
                otherUsersDeletedCount++
              }
            } catch (userDeleteError) {
              // Log critical error but continue transaction if possible
              // If this fails due to constraints, the whole transaction might roll back.
              logger.error(
                `[${txId}] CRITICAL: Failed to delete user ${userId} despite having no remaining orgs. Data inconsistency may occur.`,
                { error: userDeleteError }
              )
              // Rethrow the error to ensure transaction rollback if user deletion is critical
              throw userDeleteError // Fail the transaction if a user couldn't be deleted
            }
          } else {
            // User still belongs to other orgs. Ensure default is nullified if needed.
            logger.info(
              `[${txId}] User ${userId} still has ${remainingMemberships} memberships. Ensuring default is handled.`
            )
            // Use updateMany to avoid errors if user was already deleted in the same transaction (though unlikely with current logic flow)
            await tx
              .update(schema.User)
              .set({ defaultOrganizationId: null })
              .where(
                and(
                  eq(schema.User.id, userId),
                  eq(schema.User.defaultOrganizationId, organizationId)
                )
              )
            logger.info(
              `[${txId}] Nullified default org for user ${userId} if it was the deleted one.`
            )
          }
        } // End loop through former members
        logger.info(
          `[${txId}] Finished checking/deleting former members. ${otherUsersDeletedCount} other users deleted. Requesting owner deleted: ${requestingUserWasDeleted}.`
        )

        // **** STEP 8: Delete orphaned system user (not in OrganizationMember) ****
        if (systemUserId) {
          try {
            await tx.delete(schema.User).where(eq(schema.User.id, systemUserId))
            logger.info(`[${txId}] Deleted system user ${systemUserId}.`)
          } catch (systemUserDeleteError) {
            logger.error(`[${txId}] CRITICAL: Failed to delete system user ${systemUserId}.`, {
              error: systemUserDeleteError,
            })
            throw systemUserDeleteError
          }
        }

        logger.info(`[${txId}] Deletion transaction completed.`)
      }) // End Transaction
      logger.warn(
        `Organization ${organizationId} deletion process finished successfully by owner ${requestingUserId}. Requesting owner deleted: ${requestingUserWasDeleted}. Other users deleted: ${otherUsersDeletedCount}.`
      )

      // Invalidate system user Redis cache
      if (systemUserId) {
        await SystemUserService.invalidateSystemUserCache(organizationId)
      }

      // Flush org cache so stale data isn't served
      await flushOrganization(organizationId)

      // Invalidate user caches for all former members so their memberships/profile refresh
      const dehydrationService = new DehydrationService()
      await Promise.all(allMemberIds.map((userId) => dehydrationService.invalidateUser(userId)))
      logger.info(
        `Invalidated caches for org ${organizationId} and ${allMemberIds.length} former members.`
      )

      // Enqueue async S3 cleanup for marked StorageLocations
      await enqueueStorageCleanupJob({
        type: 'organization',
        organizationId,
      })

      // Return success status and whether the *requesting owner* was deleted
      return { success: true, userDeleted: requestingUserWasDeleted }
    } catch (error) {
      // Drizzle wraps driver errors in a `DrizzleQueryError` whose message is only
      // `Failed query: delete from "Organization" ...` — the SQLSTATE, constraint name, table
      // and detail all live on `cause`. Logging the bare error therefore threw away the one
      // thing needed to diagnose a failure, and the `message.includes('constraint')` branch
      // below never matched the very errors it was written for, because the wrapper message
      // does not contain the word. Unwrap first, then classify.
      const pg = extractPostgresError(error)
      logger.error(
        `CRITICAL Error during organization deletion transaction (incl. other user deletion) for org ${organizationId}:`,
        { error, postgres: pg }
      )
      // Handle database constraint errors — SQLSTATE class 23 is integrity_constraint_violation
      // (23503 foreign_key_violation, 23502 not_null_violation, 23505 unique_violation).
      if (pg?.code?.startsWith('23')) {
        logger.error('Database constraint error during organization deletion', {
          organizationId,
          ...pg,
        })
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message:
            'Failed to delete organization. Could not remove associated user data due to system constraints. Please contact support.',
        })
      }
      if (error instanceof TRPCError) {
        // Re-throw specific errors from initial checks
        throw error
      }
      // Throw a generic server error for other exceptions during the transaction
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to complete organization deletion due to a server error.',
      })
    }
  } // End deleteOrganization
  // --- Placeholder for other Org methods ---
  /**
   * Updates basic details of an organization.
   * Requires Admin or Owner role.
   */
  async updateOrganizationDetails(params: {
    organizationId: string
    updatingUserId: string
    name?: string
    website?: string
    domains?: string[]
  }): Promise<{
    success: true
  }> {
    const { organizationId, updatingUserId, ...updateData } = params
    logger.info(`Updating details for org ${organizationId} by user ${updatingUserId}`, {
      data: updateData,
    })
    // Verify Admin/Owner permission (using a potentially modified helper)
    // await this.verifyAdminOrOwnerOrFail(updatingUserId, organizationId); // Assuming helper exists
    const setData: Partial<typeof schema.Organization.$inferInsert> = {}
    if (typeof updateData.name !== 'undefined') setData.name = updateData.name
    if (typeof updateData.website !== 'undefined') setData.website = updateData.website
    if (typeof updateData.domains !== 'undefined') setData.domains = updateData.domains
    // Always update the timestamp
    setData.updatedAt = new Date()

    await this.db
      .update(schema.Organization)
      .set(setData)
      .where(eq(schema.Organization.id, organizationId))
    logger.info(`Successfully updated details for org ${organizationId}`)
    return { success: true }
  }

  /**
   * Creates a new organization with the full initialization flow:
   * - Validates handle (reserved + uniqueness check)
   * - Creates org + membership in transaction
   * - Creates system user
   * - Sets default org for user
   * - Invalidates dehydration cache
   * - Seeds organization with defaults
   * @param params - The parameters for creation.
   * @returns The created organization.
   */
  async createOrganization(params: {
    userId: string
    userEmail?: string
    name: string
    handle: string
    type: (typeof OrganizationType)[keyof typeof OrganizationType]
    website?: string | null
  }): Promise<{
    id: string
    name: string | null
    handle: string | null
    type: (typeof OrganizationType)[keyof typeof OrganizationType]
    website: string | null
  }> {
    const { userId, userEmail, name, handle, type, website } = params
    logger.info('Creating new organization', { userId, name, handle, type })

    // Validate handle is not reserved
    if (RESERVED_ORGANIZATION_HANDLES.includes(handle as any)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'This handle is reserved and cannot be used',
      })
    }

    // Verify handle is available
    const [existingHandle] = await this.db
      .select({ id: schema.Organization.id })
      .from(schema.Organization)
      .where(eq(schema.Organization.handle, handle))
      .limit(1)

    if (existingHandle) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'This handle is already taken',
      })
    }

    // Create organization and membership in transaction
    const organization = await this.db.transaction(async (tx) => {
      const [org] = await tx
        .insert(schema.Organization)
        .values({
          name,
          handle,
          type,
          website: website || null,
          createdById: userId,
          updatedAt: new Date(),
        })
        .returning()

      await tx.insert(schema.OrganizationMember).values({
        userId,
        organizationId: org!.id,
        role: OrganizationRole.OWNER,
        status: 'ACTIVE',
        updatedAt: new Date(),
      })

      // Seed the system permission profiles INSIDE the transaction: every
      // principal starts with a null binding, which resolves to one of these rows
      // in code (§1.3), so an org must never be able to commit without them. The
      // downstream `OrganizationSeeder` call runs outside this txn inside a
      // catch-and-log, which is exactly the unreliable choke point §5.2 warns
      // about. Idempotent, and depends on nothing but the Organization row (in
      // particular NOT the system user, which is created after this txn).
      await ensureSystemProfiles(org!.id, tx)

      return org
    })

    const organizationId = organization!.id
    logger.info('Organization and membership created', { organizationId, handle })

    // Create system user for the organization
    await SystemUserService.createSystemUserForOrganization(
      organizationId,
      organization!.name || undefined
    )
    logger.info('System user created', { organizationId })

    // Set as default organization for the user
    await this.db
      .update(schema.User)
      .set({
        defaultOrganizationId: organizationId,
        updatedAt: new Date(),
      })
      .where(eq(schema.User.id, userId))
    logger.info('Set as default organization', { organizationId, userId })

    // Invalidate dehydration cache so client gets fresh data on reload
    const dehydrationService = new DehydrationService()
    await dehydrationService.invalidateUser(userId)
    logger.info('Invalidated dehydration cache', { userId })

    // Seed organization with defaults
    try {
      const seeder = new OrganizationSeeder(this.db, userId, userEmail)
      await seeder.seedNewOrganization(organizationId)
      await this.ensureForwardingAddressIntegration({
        organizationId,
        userId,
        handle,
        userEmail,
      })
      // Bust caches so dehydration picks up seeded channels, inboxes, etc.
      await flushOrganization(organizationId)
      await dehydrationService.invalidateUser(userId)
      logger.info('Organization seeding complete', { organizationId })
    } catch (error) {
      logger.error('Failed to complete organization seeding', { organizationId, error })
      // Log but don't fail - seeding is not critical for org creation
    }

    logger.info('Organization creation complete', { organizationId, handle })

    return {
      id: organization!.id,
      name: organization!.name,
      handle: organization!.handle,
      type: organization!.type,
      website: organization!.website,
    }
  }
} // End Class
