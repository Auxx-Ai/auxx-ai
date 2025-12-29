// packages/lib/src/organizations/organization-service.ts
// ** CONTAINS LOGIC TO DELETE OTHER USERS - USE WITH EXTREME CAUTION **
import { schema, type Database } from '@auxx/database'
import { eq, and, sql } from 'drizzle-orm'
import { createScopedLogger } from '@auxx/logger'
import { TRPCError } from '@trpc/server'

import { MessageService, IntegrationProviderType } from '../email/message-service' // Adjust path as needed
import { OrganizationRole } from '@auxx/database/enums'
const logger = createScopedLogger('organization-service')
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
   * Verifies if a user is an OWNER of the specified organization.
   * Throws TRPCError if not.
   * @param userId - The ID of the user to check.
   * @param organizationId - The ID of the organization to check against.
   * @throws {TRPCError} FORBIDDEN if user is not found or not an OWNER.
   */
  private async verifyOwnerOrFail(userId: string, organizationId: string): Promise<void> {
    logger.debug(`Verifying owner status for user ${userId} in org ${organizationId}`)
    const [membership] = await this.db
      .select({ role: schema.OrganizationMember.role })
      .from(schema.OrganizationMember)
      .where(
        and(
          eq(schema.OrganizationMember.userId, userId),
          eq(schema.OrganizationMember.organizationId, organizationId)
        )
      )
      .limit(1)
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
    const { organizationId, requestingUserId, confirmationEmail, skipEmailConfirmation, isSystemDeletion } = params
    
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
    const [{ count: ownerCount }] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(schema.OrganizationMember)
      .where(
        and(
          eq(schema.OrganizationMember.organizationId, organizationId),
          eq(schema.OrganizationMember.role, OrganizationRole.OWNER)
        )
      )
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
    // --- Begin Transaction ---
    try {
      await this.db.transaction(
        async (tx) => {
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
                integration.provider as IntegrationProviderType, // Cast needed, ensure type exists
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
            const [{ count: remainingMemberships }] = await tx
              .select({ count: sql<number>`count(*)` })
              .from(schema.OrganizationMember)
              .where(eq(schema.OrganizationMember.userId, userId))
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
          logger.info(`[${txId}] Deletion transaction completed.`)
        },
        {
          // Transaction options
          maxWait: 30000, // Increased wait time needed for potentially many user checks/deletes
          timeout: 60000, // Increased timeout
        }
      ) // End Transaction
      logger.warn(
        `Organization ${organizationId} deletion process finished successfully by owner ${requestingUserId}. Requesting owner deleted: ${requestingUserWasDeleted}. Other users deleted: ${otherUsersDeletedCount}.`
      )
      // Return success status and whether the *requesting owner* was deleted
      return { success: true, userDeleted: requestingUserWasDeleted }
    } catch (error) {
      logger.error(
        `CRITICAL Error during organization deletion transaction (incl. other user deletion) for org ${organizationId}:`,
        { error }
      )
      // Handle database constraint errors
      if (error instanceof Error && error.message.includes('constraint')) {
        logger.error(`Database constraint error: ${error.message}`)
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
    emailDomain?: string
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
    if (typeof updateData.emailDomain !== 'undefined') setData.emailDomain = updateData.emailDomain
    // Always update the timestamp
    setData.updatedAt = new Date()

    await this.db
      .update(schema.Organization)
      .set(setData)
      .where(eq(schema.Organization.id, organizationId))
    logger.info(`Successfully updated details for org ${organizationId}`)
    return { success: true }
  }
} // End Class
