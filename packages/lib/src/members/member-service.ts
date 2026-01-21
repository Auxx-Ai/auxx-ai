/*
 * src/lib/members/member-service.ts
 * Service for managing organization members and invitations.
 */
import { database, type Database } from '@auxx/database'
import { eq, and, gt, count, sql, asc, ilike } from 'drizzle-orm'
import { schema } from '@auxx/database'
import {
  OrganizationMemberModel,
  type OrganizationInvitationEntity as OrganizationInvitation,
} from '@auxx/database/models'
import { type OrganizationRole } from '@auxx/database/types'
import { TRPCError } from '@trpc/server'
import crypto from 'crypto'
import { sendInviteEmail, sendJoinOrganizationEmail } from '@auxx/email'
import { WEBAPP_URL } from '@auxx/config/server'
import { createScopedLogger } from '@auxx/logger'
import { FeaturePermissionService } from '../permissions/feature-permission-service'
import { SubscriptionService } from '@auxx/billing'
import { FeatureKey } from '../permissions/types'
import { publisher } from '../events'

const logger = createScopedLogger('member-service')

// Default expiration time for invitations (e.g., 7 days)
const INVITATION_EXPIRATION_HOURS = 7 * 24
// Helper to generate the full invitation link
const generateAcceptLink = (token: string): string => {
  const baseUrl = WEBAPP_URL || 'http://localhost:3000'
  // Ensure no double slashes if baseUrl ends with / and path starts with /
  const acceptPath = '/accept-invitation'
  return `${baseUrl.replace(/\/$/, '')}${acceptPath}?token=${token}`
}

const generateSignupLink = (token: string): string => {
  const baseUrl = WEBAPP_URL || 'http://localhost:3000'
  const signupPath = '/signup' // Point to the signup page
  // Include the token so signup/login process can retrieve it later
  return `${baseUrl.replace(/\/$/, '')}${signupPath}?invitationToken=${token}`
}

export class MemberService {
  private db: Database
  private subscriptionService: SubscriptionService

  constructor(db: Database = database) {
    this.db = db
    const baseUrl = WEBAPP_URL || 'http://localhost:3000'
    this.subscriptionService = new SubscriptionService(this.db, baseUrl)
    // this.emailService = emailService
  }

  // --- Permission Checks ---

  private async checkAdminOrOwnerPermission(userId: string, organizationId: string): Promise<void> {
    const memberModel = new OrganizationMemberModel(organizationId, this.db)
    const membershipResult = await memberModel.findMemberByUser(userId)

    if (!membershipResult.ok) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to check member permissions.',
      })
    }

    const membership = membershipResult.value
    if (!membership || (membership.role !== 'OWNER' && membership.role !== 'ADMIN')) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'You must be an Owner or Admin to perform this action.',
      })
    }
  }

  private async checkOwnerPermission(userId: string, organizationId: string): Promise<void> {
    const memberModel = new OrganizationMemberModel(organizationId, this.db)
    const membershipResult = await memberModel.findMemberByUser(userId)

    if (!membershipResult.ok) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to check member permissions.',
      })
    }

    const membership = membershipResult.value
    if (!membership || membership.role !== 'OWNER') {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'You must be an Owner to perform this action.',
      })
    }
  }

  // --- Helper Methods ---

  /**
   * Checks if a user is a member of the specified organization.
   */
  async isMember(userId: string, organizationId: string): Promise<boolean> {
    return MemberService.isMember(userId, organizationId, this.db)
  }

  /**
   * Get membership record for a user in an organization
   */
  static async getMembership(
    userId: string,
    organizationId: string,
    db: Database = database
  ) {
    return db.query.OrganizationMember.findFirst({
      where: (om, { and, eq }) =>
        and(eq(om.userId, userId), eq(om.organizationId, organizationId)),
    })
  }

  /**
   * Static version: Checks if a user is a member of the specified organization.
   */
  static async isMember(
    userId: string,
    organizationId: string,
    db: Database = database
  ): Promise<boolean> {
    const membership = await MemberService.getMembership(userId, organizationId, db)
    if (!membership) {
      return false
    }

    // Additional check for user type - need to query user table
    const [user] = await db
      .select({ userType: schema.User.userType })
      .from(schema.User)
      .where(eq(schema.User.id, userId))
      .limit(1)

    return user?.userType === 'USER'
  }

  // --- Core Member Operations ---

  /**
   * Invites a user to the organization by creating an invitation record
   * and sending an email, regardless of whether the user already exists.
   */
  async inviteMember(params: {
    organizationId: string
    inviterUserId: string
    inviterName: string | null
    organizationName: string | null
    email: string
    role: OrganizationRole
  }): Promise<{ success: true; message: string; existingUser: boolean }> {
    const { organizationId, inviterUserId, inviterName, organizationName, email, role } = params

    logger.info('Attempting to invite member', { organizationId, email, role, inviterUserId })

    // 1. Check inviter permissions
    await this.checkAdminOrOwnerPermission(inviterUserId, organizationId)
    if (role === 'OWNER') {
      await this.checkOwnerPermission(inviterUserId, organizationId)
    }

    // 2. Check if an active user with this email exists (exclude system users)
    const [existingUser] = await this.db
      .select({ id: schema.User.id, name: schema.User.name })
      .from(schema.User)
      .where(
        and(
          eq(schema.User.email, email),
          eq(schema.User.userType, 'USER') // Only regular users can be invited
        )
      )
      .limit(1)

    // 3. Check if user is ALREADY a member of THIS organization
    if (existingUser) {
      const memberModel = new OrganizationMemberModel(organizationId, this.db)
      const membershipResult = await memberModel.findMemberByUser(existingUser.id)

      if (membershipResult.ok && membershipResult.value) {
        logger.warn('User is already a member', { userId: existingUser.id, organizationId })
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'This user is already a member of the organization.',
        })
      }
    }

    // 4. Check for existing *pending* invitation for this email in THIS organization
    const [existingPendingInvitation] = await this.db
      .select({ id: schema.OrganizationInvitation.id })
      .from(schema.OrganizationInvitation)
      .where(
        and(
          eq(schema.OrganizationInvitation.organizationId, organizationId),
          eq(schema.OrganizationInvitation.email, email),
          eq(schema.OrganizationInvitation.status, 'PENDING'),
          gt(schema.OrganizationInvitation.expiresAt, new Date())
        )
      )
      .limit(1)

    if (existingPendingInvitation) {
      logger.warn('Pending invitation already exists for this email', { email, organizationId })
      // TODO: Decide whether to resend or error out. Current: Error.
      // If resending: find the invite, update timestamp?, resend email. Skip creation.
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'An active invitation already exists for this email address.',
      })
    }

    // --- If not already a member and no pending invite, proceed to create invitation ---
    logger.info('Proceeding to create invitation.', {
      email,
      organizationId,
      existingUserId: existingUser?.id,
    })

    // 5. Create the invitation record in the database
    const token = crypto.randomBytes(32).toString('hex')
    const expiresAt = new Date()
    expiresAt.setHours(expiresAt.getHours() + INVITATION_EXPIRATION_HOURS)

    try {
      await this.db.insert(schema.OrganizationInvitation).values({
        organizationId,
        email,
        role,
        token,
        expiresAt,
        status: 'PENDING',
        invitedById: inviterUserId,
        updatedAt: new Date(),
        // Note: acceptedById remains null until accepted
      })
      logger.info('Organization invitation record created in DB', { email, organizationId })
    } catch (dbError: any) {
      logger.error('Failed to create invitation record in DB', {
        email,
        organizationId,
        error: dbError,
      })
      // Handle potential DB errors (e.g., constraints if logic changes)
      if (dbError?.code === '23505' || dbError?.constraint) {
        // Postgres unique constraint violation
        throw new TRPCError({ code: 'CONFLICT', message: 'An invitation conflict occurred.' })
      }
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Database error creating invitation.',
      })
    }

    // 6. Send the appropriate invitation email
    const senderName = inviterName || 'A team member'
    const orgName = organizationName || 'our organization'

    try {
      if (existingUser) {
        const acceptLink = `${WEBAPP_URL}/accept-invitation?token=${token}` // Ensure URL is defined

        publisher.publishLater({
          type: 'membership:created',
          data: {
            userId: existingUser.id,
            isNewUser: false,
            organizationId,
            email,
            role,
            token,
            expiresAt,
            status: 'PENDING',
            invitedById: inviterUserId,
          },
        })

        // Send email tailored for existing users
        await sendJoinOrganizationEmail({
          email,
          inviterName: senderName,
          organizationName: orgName,
          role: role.toString(),
          acceptLink,
          invitedUserName: existingUser.name!, // Pass user's name if available
        })
        logger.info('Organization join invitation email sent (existing user)', {
          email,
          organizationId,
        })
        return { success: true, message: 'Invitation sent to existing user.', existingUser: true }
      } else {
        // Send email tailored for new users
        const signupLink = generateSignupLink(token) // Generate signup link for new users

        publisher.publishLater({
          type: 'membership:created',
          data: {
            userId: null,
            isNewUser: true,
            organizationId,
            email,
            role,
            token,
            expiresAt,
            status: 'PENDING',
            invitedById: inviterUserId,
          },
        })

        await sendInviteEmail({
          email,
          inviterName: senderName,
          organizationName: orgName,
          role: role.toString(),
          acceptLink: signupLink,
        })
        logger.info('Organization invitation email sent (new user)', { email, organizationId })
        return { success: true, message: 'Invitation sent to new user.', existingUser: false }
      }
    } catch (emailError) {
      // If email sending fails, attempt to roll back the DB creation
      logger.error('Failed to send invitation email, attempting to roll back DB record', {
        email,
        organizationId,
        token,
        error: emailError,
      })
      try {
        await this.db
          .delete(schema.OrganizationInvitation)
          .where(
            and(
              eq(schema.OrganizationInvitation.organizationId, organizationId),
              eq(schema.OrganizationInvitation.email, email),
              eq(schema.OrganizationInvitation.token, token)
            )
          )
        logger.info('Rolled back invitation record after email failure', {
          email,
          organizationId,
          token,
        })
      } catch (rollbackError) {
        logger.error('CRITICAL: Failed to roll back invitation record after email failure', {
          email,
          organizationId,
          token,
          rollbackError,
        })
        // Log this critical failure, manual cleanup might be needed
      }
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Invitation created, but failed to send email. Please try again.', // Adjusted message
        cause: emailError,
      })
    }
  } // End inviteMember

  /**
   * Cancels a pending organization invitation.
   */
  async cancelInvitation(params: {
    invitationId: string
    cancellerUserId: string
    // No need for organizationId here if we trust invitationId is unique and relates to the canceller's org context implicitly
    // However, explicitly passing organizationId and verifying canceller membership adds security
    organizationId: string
  }): Promise<{ success: true }> {
    const { invitationId, cancellerUserId, organizationId } = params

    logger.info('Attempting to cancel invitation', {
      invitationId,
      cancellerUserId,
      organizationId,
    })

    // 1. Check canceller permissions within the specified organization
    await this.checkAdminOrOwnerPermission(cancellerUserId, organizationId)

    // 2. Find the invitation
    const [invitation] = await this.db
      .select({
        id: schema.OrganizationInvitation.id,
        status: schema.OrganizationInvitation.status,
        organizationId: schema.OrganizationInvitation.organizationId,
      })
      .from(schema.OrganizationInvitation)
      .where(eq(schema.OrganizationInvitation.id, invitationId))
      .limit(1)

    // 3. Validate invitation
    if (!invitation) {
      logger.warn('Invitation not found for cancellation', { invitationId })
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Invitation not found.' })
    }
    // Ensure the invitation belongs to the organization the canceller has rights in
    if (invitation.organizationId !== organizationId) {
      logger.error('Permission mismatch: Canceller org does not match invitation org', {
        invitationId,
        cancellerOrgId: organizationId,
        inviteOrgId: invitation.organizationId,
      })
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'You do not have permission to cancel this invitation.',
      })
    }
    if (invitation.status !== 'PENDING') {
      logger.warn('Attempted to cancel non-pending invitation', {
        invitationId,
        status: invitation.status,
      })
      // Decide how to handle: error or silently succeed? Error is clearer.
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Only pending invitations can be cancelled.',
      })
    }

    // 4. Update invitation status to CANCELLED
    await this.db
      .update(schema.OrganizationInvitation)
      .set({ status: 'CANCELLED' })
      .where(eq(schema.OrganizationInvitation.id, invitationId))

    logger.info('Invitation cancelled successfully', { invitationId })
    return { success: true }
  }

  /**
   * Resends a pending organization invitation email.
   * Generates a new token and updates the expiry time.
   */
  async resendInvitation(params: {
    invitationId: string
    resenderUserId: string
    organizationId: string // Required to verify resender permissions and get org details
  }): Promise<{ success: true; message: string }> {
    const { invitationId, resenderUserId, organizationId } = params

    logger.info('Attempting to resend invitation', { invitationId, resenderUserId, organizationId })

    // 1. Check resender permissions
    const resenderMembership = await this.checkAdminOrOwnerPermission(
      resenderUserId,
      organizationId
    )

    // 2. Find the invitation and necessary related data for email
    const invitation = await this.db.query.OrganizationInvitation.findFirst({
      where: eq(schema.OrganizationInvitation.id, invitationId),
      with: {
        organization: {
          columns: {
            name: true,
          },
        },
        invitedBy: {
          columns: {
            name: true,
          },
        },
      },
    })

    // 3. Validate invitation
    if (!invitation) {
      logger.warn('Invitation not found for resend', { invitationId })
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Invitation not found.' })
    }
    if (invitation.organizationId !== organizationId) {
      logger.error('Permission mismatch: Resender org does not match invitation org', {
        invitationId,
        resenderOrgId: organizationId,
        inviteOrgId: invitation.organizationId,
      })
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'You do not have permission to resend this invitation.',
      })
    }
    if (invitation.status !== 'PENDING') {
      logger.warn('Attempted to resend non-pending invitation', {
        invitationId,
        status: invitation.status,
      })
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Only pending invitations can be resent.',
      })
    }
    // Optional: Check expiry? Maybe allow resending expired ones? For now, let's allow.
    // if (invitation.expiresAt < new Date()) { ... }

    // 4. Generate new token and expiry
    const newToken = crypto.randomBytes(32).toString('hex')
    const newExpiresAt = new Date()
    newExpiresAt.setHours(newExpiresAt.getHours() + INVITATION_EXPIRATION_HOURS)

    // 5. Update the invitation record
    try {
      await this.db
        .update(schema.OrganizationInvitation)
        .set({
          token: newToken,
          expiresAt: newExpiresAt,
          // updatedAt will be handled by the schema default
        })
        .where(eq(schema.OrganizationInvitation.id, invitationId))
      logger.info('Invitation record updated with new token/expiry', { invitationId })
    } catch (dbError) {
      logger.error('Failed to update invitation record for resend', {
        invitationId,
        error: dbError,
      })
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Database error updating invitation for resend.',
      })
    }

    // 6. Send the email using the NEW token
    const newAcceptLink = generateAcceptLink(newToken)
    const inviterName = invitation.invitedBy?.name || 'A team member' // Use original inviter's name
    const orgName = invitation.organization.name || 'our organization'

    try {
      // Check if the invited email corresponds to an existing user to send correct template
      const existingUser = await this.db.query.User.findFirst({
        where: and(
          eq(schema.User.email, invitation.email),
          eq(schema.User.userType, 'USER') // Only regular users
        ),
        columns: {
          name: true,
        },
      })

      if (existingUser) {
        await sendJoinOrganizationEmail({
          email: invitation.email,
          inviterName,
          organizationName: orgName,
          role: invitation.role.toString(),
          acceptLink: newAcceptLink,
          invitedUserName: existingUser.name!,
        })
        logger.info('Resent organization join invitation email (existing user)', {
          invitationId,
          email: invitation.email,
        })
      } else {
        await sendInviteEmail({
          email: invitation.email,
          inviterName,
          organizationName: orgName,
          role: invitation.role.toString(),
          acceptLink: newAcceptLink,
        })
        logger.info('Resent organization invitation email (new user)', {
          invitationId,
          email: invitation.email,
        })
      }

      return { success: true, message: 'Invitation resent successfully.' }
    } catch (emailError) {
      logger.error('Failed to resend invitation email (DB record was updated)', {
        invitationId,
        email: invitation.email,
        error: emailError,
      })
      // Note: DB record *was* updated with new token. Inform user email failed.
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message:
          'Invitation token updated, but failed to resend email. Please try resending again.',
        cause: emailError,
      })
    }
  }

  /**
   * PRIVATE HELPER: Core logic for accepting an invitation after initial validation.
   * Handles plan limits, DB transaction (member create, invite update, seat increment),
   * Stripe update, setting default org, and cache invalidation.
   * Assumes the provided invitation is valid (found, PENDING, not expired, email matches).
   */
  private async _processInvitationAcceptance(
    invitation: OrganizationInvitation, // Pass the validated invitation object
    acceptingUserId: string
  ): Promise<{ success: true; organizationId: string }> {
    const organizationId = invitation.organizationId
    logger.info('Starting core invitation acceptance process', {
      organizationId,
      acceptingUserId,
      invitationId: invitation.id,
    })
    const featureService = new FeaturePermissionService(this.db)
    // 1. Check Feature Limit BEFORE Transaction
    const memberLimit = await featureService.getLimit(organizationId, FeatureKey.TEAMMATES)
    let activeMemberCount = 0 // Initialize count

    if (typeof memberLimit === 'number' && memberLimit >= 0) {
      // Check numeric limits (including 0)
      const memberModel = new OrganizationMemberModel(organizationId, this.db)
      const countResult = await memberModel.count({
        where: eq(schema.OrganizationMember.status, 'ACTIVE'),
      })

      if (!countResult.ok) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to check member count.',
        })
      }

      activeMemberCount = countResult.value ?? 0

      if (activeMemberCount >= memberLimit) {
        logger.warn('Invitation acceptance blocked by helper: Member limit reached.', {
          organizationId,
          acceptingUserId,
          limit: memberLimit,
          current: activeMemberCount,
        })
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: `Cannot join organization: The member limit (${memberLimit}) for the current plan has been reached.`,
        })
      }
      logger.info('Helper: Member limit check passed.', {
        organizationId,
        acceptingUserId,
        limit: memberLimit,
        current: activeMemberCount,
      })
    } else if (memberLimit === '+') {
      logger.info('Helper: Member limit is unlimited, allowing join.', {
        organizationId,
        acceptingUserId,
      })
    } else {
      // Covers false, null, undefined
      logger.error(
        'Helper: Invitation acceptance blocked: Plan does not allow members or limit invalid.',
        { organizationId, acceptingUserId, limit: memberLimit }
      )
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Cannot join organization: The current plan does not allow additional members.',
      })
    }

    // 2. DB Transaction: Add user, update seats, update invitation
    let newSeatCount = 0
    try {
      const result = await this.db.transaction(async (tx) => {
        // Create new organization member
        const [newMember] = await tx
          .insert(schema.OrganizationMember)
          .values({
            userId: acceptingUserId,
            organizationId: organizationId,
            role: invitation.role,
            status: 'ACTIVE', // Set as Active
            updatedAt: new Date(),
          })
          .returning()

        // Update invitation status
        const [updatedInvite] = await tx
          .update(schema.OrganizationInvitation)
          .set({
            status: 'ACCEPTED',
            acceptedById: acceptingUserId,
            acceptedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(schema.OrganizationInvitation.id, invitation.id))
          .returning()

        // Update subscription seats
        const [subUpdate] = await tx
          .update(schema.PlanSubscription)
          .set({
            seats: sql`${schema.PlanSubscription.seats} + 1`,
          })
          .where(eq(schema.PlanSubscription.organizationId, organizationId))
          .returning({ seats: schema.PlanSubscription.seats })

        return { newMember, updatedInvite, subUpdate }
      })

      newSeatCount = result.subUpdate.seats
      logger.info('Helper: DB transaction successful', {
        userId: acceptingUserId,
        organizationId,
        newSeatCount,
      })
    } catch (error) {
      logger.error('Helper: Error during transaction for accepting invitation', {
        error,
        userId: acceptingUserId,
        organizationId,
      })
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to accept invitation due to a database error.',
      })
    }

    // 3. Update Stripe Subscription Seats (AFTER DB transaction succeeds)
    try {
      const subscription = await this.db.query.PlanSubscription.findFirst({
        where: (sub, { eq }) => eq(sub.organizationId, organizationId),
        columns: {
          stripeSubscriptionId: true,
          plan: true,
          billingCycle: true,
        },
      })

      if (subscription?.stripeSubscriptionId) {
        const billingCycle = subscription.billingCycle
        if (billingCycle !== 'MONTHLY' && billingCycle !== 'ANNUAL') {
          logger.warn('Skipping Stripe seat update due to unsupported billing cycle', {
            organizationId,
            billingCycle,
          })
        } else {
          logger.info('Updating Stripe subscription seats via billing service', {
            organizationId,
            newSeatCount,
          })

          const updateResult = await this.subscriptionService.updateSubscriptionDirect({
            organizationId,
            planName: subscription.plan,
            billingCycle,
            seats: newSeatCount,
          })

          if (!updateResult.success) {
            logger.warn('Stripe subscription update requires follow-up action', {
              organizationId,
              newSeatCount,
              subscriptionRequiresAction: updateResult.requiresAction ?? false,
            })
          } else {
            logger.info('Stripe subscription seats updated successfully', {
              organizationId,
              newSeatCount,
            })
          }
        }
      } else {
        logger.info('Skipping Stripe seat update (no subscription)', {
          organizationId,
        })
      }
    } catch (stripeError) {
      logger.error('CRITICAL: Failed to update Stripe seats', {
        userId: acceptingUserId,
        organizationId,
        expectedSeatCount: newSeatCount,
        error: stripeError instanceof Error ? stripeError.message : String(stripeError),
      })
      // DO NOT throw error here to ensure user join isn't blocked by Stripe failure. Monitor logs.
    }

    // 4. Set as default organization if needed (AFTER DB transaction and Stripe attempt)
    const [user] = await this.db
      .select({ defaultOrganizationId: schema.User.defaultOrganizationId })
      .from(schema.User)
      .where(eq(schema.User.id, acceptingUserId))
      .limit(1)

    if (!user?.defaultOrganizationId) {
      try {
        await this.db
          .update(schema.User)
          .set({ defaultOrganizationId: organizationId })
          .where(eq(schema.User.id, acceptingUserId))
        logger.info('Helper: Set default organization for user', {
          userId: acceptingUserId,
          organizationId,
        })
      } catch (userUpdateError) {
        logger.error('Helper: Failed to set default organization for user', {
          userId: acceptingUserId,
          organizationId,
          error: userUpdateError,
        })
        // Non-critical error.
      }
    }

    // 5. Cache Invalidation
    try {
      await featureService.invalidateCache(organizationId)
      // Invalidate other relevant caches (e.g., member lists) if necessary
      logger.info('Helper: Relevant caches invalidated.', { organizationId })
    } catch (cacheError) {
      logger.warn('Helper: Failed to invalidate cache.', { organizationId, error: cacheError })
    }

    // 6. Return Success
    return { success: true, organizationId: organizationId }
  }

  /**
   * Accepts an organization invitation (found via TOKEN).
   * Verifies the token, checks email match, existing membership, then processes acceptance.
   */
  async acceptInvitation(params: {
    token: string
    acceptingUserId: string
    acceptingUserEmail: string | null
  }): Promise<{ success: true; organizationId: string }> {
    const { token, acceptingUserId, acceptingUserEmail } = params
    logger.info('Attempting to accept invitation via token', { token, acceptingUserId })

    if (!acceptingUserEmail)
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'User email not available.' })

    // 1. Find by token and Validate (Existence, Status, Expiry, Email Match)
    const invitation = await this.db.query.OrganizationInvitation.findFirst({
      where: eq(schema.OrganizationInvitation.token, token),
    })

    if (!invitation)
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Invitation not found or invalid.' })
    if (invitation.status !== 'PENDING')
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Invitation has already been used or is no longer valid.',
      })
    if (invitation.expiresAt < new Date()) {
      await this.db
        .update(schema.OrganizationInvitation)
        .set({ status: 'EXPIRED' })
        .where(eq(schema.OrganizationInvitation.id, invitation.id))
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invitation has expired.' })
    }
    if (invitation.email.toLowerCase() !== acceptingUserEmail.toLowerCase()) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'This invitation is intended for a different email address.',
      })
    }

    // 2. Check if already member (Token flow: okay if already member, just mark invite accepted)
    const memberModel = new OrganizationMemberModel(invitation.organizationId, this.db)
    const membershipResult = await memberModel.findMemberByUser(acceptingUserId)

    const existingMembership = membershipResult.ok ? membershipResult.value : null
    if (existingMembership) {
      logger.warn('User (via token) is already a member', {
        userId: acceptingUserId,
        organizationId: invitation.organizationId,
      })
      // Ensure invite is marked accepted for tracking consistency
      await this.db
        .update(schema.OrganizationInvitation)
        .set({
          status: 'ACCEPTED',
          acceptedById: acceptingUserId,
          acceptedAt: new Date(),
        })
        .where(eq(schema.OrganizationInvitation.id, invitation.id))
      return { success: true, organizationId: invitation.organizationId }
    }

    // 3. Delegate to core processing logic
    logger.info('Token invite validated, proceeding to core processing.', {
      token,
      acceptingUserId,
      organizationId: invitation.organizationId,
    })
    return this._processInvitationAcceptance(invitation, acceptingUserId)
  } // End acceptInvitation (Token)

  /**
   * Accepts an organization invitation (found via INVITATION ID).
   * Verifies the ID, checks email match, existing membership, then processes acceptance.
   */
  async acceptInvitationByIdentity(params: {
    invitationId: string
    acceptingUserId: string
    acceptingUserEmail: string | null
  }): Promise<{ success: true; organizationId: string }> {
    const { invitationId, acceptingUserId, acceptingUserEmail } = params
    logger.info('Attempting to accept invitation via identity (ID)', {
      invitationId,
      acceptingUserId,
    })

    if (!acceptingUserEmail)
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'User email not available.' })

    // 1. Find by ID and Validate (Existence, Status, Expiry, Email Match)
    const invitation = await this.db.query.OrganizationInvitation.findFirst({
      where: eq(schema.OrganizationInvitation.id, invitationId),
    })

    if (!invitation)
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Invitation not found or invalid.' })
    if (invitation.status !== 'PENDING') {
      // Specific handling for this flow if already accepted by this user
      if (invitation.status === 'ACCEPTED' && invitation.acceptedById === acceptingUserId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'You have already accepted this invitation.',
        })
      }
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invitation is no longer valid.' })
    }
    if (invitation.expiresAt < new Date()) {
      await this.db
        .update(schema.OrganizationInvitation)
        .set({ status: 'EXPIRED' })
        .where(eq(schema.OrganizationInvitation.id, invitation.id))
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invitation has expired.' })
    }
    if (invitation.email.toLowerCase() !== acceptingUserEmail.toLowerCase()) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: `This invitation is for ${invitation.email}. Your current logged-in email (${acceptingUserEmail}) does not match.`,
      })
    }

    // 2. Check if already member (ID flow: user shouldn't be accepting if already member - Error out)
    const memberModel2 = new OrganizationMemberModel(invitation.organizationId, this.db)
    const membershipResult2 = await memberModel2.findMemberByUser(acceptingUserId)

    const existingMembership = membershipResult2.ok ? membershipResult2.value : null
    if (existingMembership) {
      logger.warn('User (via ID) is already a member, but trying to accept again.', {
        userId: acceptingUserId,
        organizationId: invitation.organizationId,
      })
      // Mark invite accepted for tracking consistency, but throw error as this indicates a UI issue
      await this.db
        .update(schema.OrganizationInvitation)
        .set({
          status: 'ACCEPTED',
          acceptedById: acceptingUserId,
          acceptedAt: new Date(),
        })
        .where(eq(schema.OrganizationInvitation.id, invitation.id))
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'You are already a member of this organization.',
      })
    }

    // 3. Delegate to core processing logic
    logger.info('ID invite validated, proceeding to core processing.', {
      invitationId,
      acceptingUserId,
      organizationId: invitation.organizationId,
    })
    return this._processInvitationAcceptance(invitation, acceptingUserId)
  }

  /**
   * Removes a member from the organization.
   */
  async removeMember(params: {
    organizationId: string
    removerUserId: string
    memberToRemoveId: string
  }): Promise<{ success: true }> {
    const { organizationId, removerUserId, memberToRemoveId } = params

    logger.info('Attempting to remove member', { organizationId, memberToRemoveId, removerUserId })

    // 1. Check permissions of the user performing the action
    const removerModel = new OrganizationMemberModel(organizationId, this.db)
    const removerResult = await removerModel.findMemberByUser(removerUserId)

    const removerMembership = removerResult.ok ? removerResult.value : null
    if (!removerMembership) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'You are not a member of this organization.',
      })
    }

    // 2. Get the membership of the user to be removed
    const targetResult = await removerModel.findMemberByUser(memberToRemoveId)

    const targetMembership = targetResult.ok ? targetResult.value : null
    if (!targetMembership) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Member not found in this organization.' })
    }

    // 3. Apply permission rules
    if (removerUserId === memberToRemoveId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: "You cannot remove yourself. Use 'Leave Organization' instead.",
      })
    }
    if (
      removerMembership.role !== 'OWNER' &&
      (removerMembership.role !== 'ADMIN' || targetMembership.role !== 'USER')
    ) {
      logger.warn('Permission denied for removing member', {
        removerRole: removerMembership.role,
        targetRole: targetMembership.role,
        removerUserId,
        memberToRemoveId,
      })
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: "You don't have permission to remove this member.",
      })
    }
    // Prevent removing the last owner
    if (targetMembership.role === 'OWNER') {
      const ownerCountResult = await removerModel.count({
        where: eq(schema.OrganizationMember.role, 'OWNER'),
      })

      if (!ownerCountResult.ok) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to check owner count.',
        })
      }

      if (ownerCountResult && ownerCountResult?.value <= 1) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cannot remove the only owner. Transfer ownership first.',
        })
      }
    }

    // 4. Remove the member
    const deleteResult = await removerModel.delete(targetMembership.id)

    if (!deleteResult.ok) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to remove member.',
      })
    }

    logger.info('Member removed successfully', { organizationId, memberToRemoveId, removerUserId })
    return { success: true }
  }

  /**
   * Updates a member's role within the organization.
   */
  async updateMemberRole(params: {
    organizationId: string
    updaterUserId: string
    memberToUpdateId: string
    newRole: OrganizationRole
  }): Promise<{ success: true }> {
    const { organizationId, updaterUserId, memberToUpdateId, newRole } = params

    logger.info('Attempting to update member role', {
      organizationId,
      memberToUpdateId,
      newRole,
      updaterUserId,
    })

    // 1. Check permissions of the user performing the action
    const updaterModel = new OrganizationMemberModel(organizationId, this.db)
    const updaterResult = await updaterModel.findMemberByUser(updaterUserId)

    const updaterMembership = updaterResult.ok ? updaterResult.value : null
    if (!updaterMembership) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'You are not a member of this organization.',
      })
    }

    // 2. Get the membership of the user being updated
    const targetResult = await updaterModel.findMemberByUser(memberToUpdateId)

    const targetMembership = targetResult.ok ? targetResult.value : null
    if (!targetMembership) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Member not found.' })
    }

    // Cannot update own role
    if (updaterUserId === memberToUpdateId) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'You cannot change your own role.' })
    }

    // 3. Apply permission rules
    if (
      updaterMembership.role !== 'OWNER' &&
      (newRole === 'OWNER' || targetMembership.role === 'OWNER')
    ) {
      logger.warn('Permission denied for managing owner roles', {
        updaterRole: updaterMembership.role,
        targetRole: targetMembership.role,
        newRole,
        updaterUserId,
        memberToUpdateId,
      })
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Only Owners can manage Owner roles.' })
    }
    if (updaterMembership.role !== 'OWNER' && updaterMembership.role !== 'ADMIN') {
      logger.warn('Permission denied for updating roles', {
        updaterRole: updaterMembership.role,
        updaterUserId,
      })
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: "You don't have permission to update member roles.",
      })
    }
    // Admin cannot update another Admin's role
    if (updaterMembership.role === 'ADMIN' && targetMembership.role === 'ADMIN') {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Admins cannot change the role of other Admins.',
      })
    }

    // 4. Prevent removing the last owner by changing their role
    if (targetMembership.role === 'OWNER' && newRole !== 'OWNER') {
      const ownerCountResult = await updaterModel.count({
        where: eq(schema.OrganizationMember.role, 'OWNER'),
      })

      if (!ownerCountResult.ok) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to check owner count.',
        })
      }

      if (ownerCountResult?.value <= 1) {
        logger.warn('Attempted to change role of the last owner', {
          organizationId,
          memberToUpdateId,
        })
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cannot change the role of the only Owner. Transfer ownership first.',
        })
      }
    }

    // 5. Update the role
    const updateResult = await updaterModel.update(targetMembership.id, { role: newRole })

    if (!updateResult.ok) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to update member role.',
      })
    }

    logger.info('Member role updated successfully', {
      organizationId,
      memberToUpdateId,
      newRole,
      updaterUserId,
    })
    return { success: true }
  }

  /**
   * Retrieves all active members of an organization (excludes system users).
   */
  async getOrganizationMembers(organizationId: string) {
    const members = await this.db.query.OrganizationMember.findMany({
      where: eq(schema.OrganizationMember.organizationId, organizationId),
      with: {
        user: {
          columns: {
            id: true,
            name: true,
            email: true,
            image: true,
          },
          where: (user: typeof schema.User, { eq }) => eq(user.userType, 'USER'), // Exclude system users from member lists
        },
      },
      orderBy: [asc(schema.OrganizationMember.role)],
    })

    const roleOrder: Record<OrganizationRole, number> = { OWNER: 0, ADMIN: 1, USER: 2 }
    return members.sort((a, b) => {
      const roleDifference = roleOrder[a.role] - roleOrder[b.role]
      if (roleDifference !== 0) {
        return roleDifference
      }

      const nameA = a.user?.name?.toLocaleLowerCase() ?? ''
      const nameB = b.user?.name?.toLocaleLowerCase() ?? ''
      if (nameA !== nameB) {
        return nameA.localeCompare(nameB)
      }

      const emailA = a.user?.email?.toLocaleLowerCase() ?? ''
      const emailB = b.user?.email?.toLocaleLowerCase() ?? ''
      return emailA.localeCompare(emailB)
    })
  }

  /**
   * Retrieves pending invitations for an organization.
   */
  async getPendingInvitations(organizationId: string) {
    return this.db.query.OrganizationInvitation.findMany({
      where: and(
        eq(schema.OrganizationInvitation.organizationId, organizationId),
        eq(schema.OrganizationInvitation.status, 'PENDING'),
        gt(schema.OrganizationInvitation.expiresAt, new Date()) // Only show non-expired
      ),
      columns: {
        id: true,
        email: true,
        role: true,
        createdAt: true,
        expiresAt: true,
      },
      with: {
        invitedBy: {
          columns: {
            name: true,
            id: true,
          },
        },
      },
      orderBy: [asc(schema.OrganizationInvitation.createdAt)],
    })
  }

  /**
   * Retrieves the actual invitation link for a pending invitation.
   * Requires Admin or Owner privileges.
   */
  async getInvitationLink(params: {
    invitationId: string
    requestingUserId: string
    organizationId: string // Context for permission check
  }): Promise<string> {
    const { invitationId, requestingUserId, organizationId } = params

    logger.info('Attempting to retrieve invitation link', {
      invitationId,
      requestingUserId,
      organizationId,
    })

    // 1. Check requester permissions within the specified organization
    await this.checkAdminOrOwnerPermission(requestingUserId, organizationId)

    // 2. Find the invitation
    const invitation = await this.db.query.OrganizationInvitation.findFirst({
      where: eq(schema.OrganizationInvitation.id, invitationId),
      columns: {
        id: true,
        status: true,
        token: true, // Need the token to build the link
        expiresAt: true,
        organizationId: true,
      },
    })

    // 3. Validate invitation
    if (!invitation) {
      logger.warn('Invitation not found for link retrieval', { invitationId })
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Invitation not found.' })
    }
    // Ensure the invitation belongs to the organization the requester has rights in
    if (invitation.organizationId !== organizationId) {
      logger.error(
        'Permission mismatch: Requester org does not match invitation org for link retrieval',
        { invitationId, requesterOrgId: organizationId, inviteOrgId: invitation.organizationId }
      )
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'You do not have permission to access this invitation.',
      })
    }
    if (invitation.status !== 'PENDING') {
      logger.warn('Attempted to get link for non-pending invitation', {
        invitationId,
        status: invitation.status,
      })
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Links can only be retrieved for pending invitations.',
      })
    }
    if (invitation.expiresAt < new Date()) {
      logger.warn('Attempted to get link for expired invitation', { invitationId })
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'This invitation has expired.' })
    }

    // 4. Construct and return the link
    const link = generateAcceptLink(invitation.token)
    logger.info('Invitation link retrieved successfully', { invitationId })
    return link
  }

  /**
   * Get count of active members in organization
   */
  async getActiveMemberCount(organizationId: string): Promise<number> {
    const rows = await this.db
      .select({ id: schema.OrganizationMember.id })
      .from(schema.OrganizationMember)
      .where(
        and(
          eq(schema.OrganizationMember.organizationId, organizationId),
          eq(schema.OrganizationMember.status, 'ACTIVE')
        )
      )
    return rows.length
  }

  /**
   * Get pending invitations for current user across all organizations
   */
  async getMyPendingInvitations(userEmail: string | null) {
    if (!userEmail) {
      return []
    }

    return this.db
      .select({
        id: schema.OrganizationInvitation.id,
        role: schema.OrganizationInvitation.role,
        createdAt: schema.OrganizationInvitation.createdAt,
        expiresAt: schema.OrganizationInvitation.expiresAt,
        organization: {
          id: schema.Organization.id,
          name: schema.Organization.name,
        },
        invitedBy: {
          id: schema.User.id,
          name: schema.User.name,
          image: schema.User.image,
        },
      })
      .from(schema.OrganizationInvitation)
      .innerJoin(
        schema.Organization,
        eq(schema.OrganizationInvitation.organizationId, schema.Organization.id)
      )
      .innerJoin(schema.User, eq(schema.OrganizationInvitation.invitedById, schema.User.id))
      .where(
        and(
          ilike(schema.OrganizationInvitation.email, userEmail),
          eq(schema.OrganizationInvitation.status, 'PENDING'),
          gt(schema.OrganizationInvitation.expiresAt, new Date())
        )
      )
  }
}
