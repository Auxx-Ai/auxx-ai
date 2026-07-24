// packages/lib/src/members/accept-invitation.ts

import { SubscriptionService } from '@auxx/billing'
import { WEBAPP_URL } from '@auxx/config/server'
import { type Database, database, schema } from '@auxx/database'
import type {
  OrganizationInvitationEntity as OrganizationInvitation,
  OrganizationRole,
  SeatType,
} from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
import { and, count, eq, sql } from 'drizzle-orm'
import { BadRequestError, ForbiddenError, NotFoundError } from '../errors'
import { FeaturePermissionService } from '../permissions/feature-permission-service'
import { FeatureKey } from '../permissions/types'
import { findMemberByUser } from './member-queries'

const logger = createScopedLogger('member-service')

/**
 * Core logic for accepting an invitation after initial validation.
 * Handles plan limits, DB transaction (member create, invite update, seat
 * increment), Stripe update, setting default org, and cache invalidation.
 * Assumes the provided invitation is valid (found, PENDING, not expired, email
 * matches).
 */
async function processInvitationAcceptance(
  invitation: OrganizationInvitation, // Pass the validated invitation object
  acceptingUserId: string,
  db: Database
): Promise<{ success: true; organizationId: string }> {
  const organizationId = invitation.organizationId
  logger.info('Starting core invitation acceptance process', {
    organizationId,
    acceptingUserId,
    invitationId: invitation.id,
  })
  const subscriptionService = new SubscriptionService(db, WEBAPP_URL || 'http://localhost:3000')
  const featureService = new FeaturePermissionService(db)
  // 1. Check Feature Limit BEFORE Transaction (seat-class aware §2.G — a field
  // (worker) seat consumes a worker seat, checked against workerSeats; a full seat
  // against teammates). Each class counts only its own active members.
  const seatClass: SeatType = invitation.seatType === 'worker' ? 'worker' : 'full'
  const isWorkerSeat = seatClass === 'worker'
  const memberLimit = await featureService.getLimit(
    organizationId,
    isWorkerSeat ? FeatureKey.workerSeats : FeatureKey.teammates
  )
  let activeMemberCount = 0 // Initialize count

  if (typeof memberLimit === 'number' && memberLimit >= 0) {
    // Check numeric limits (including 0) — scoped to the joining seat class
    const [countRow] = await db
      .select({ value: count() })
      .from(schema.OrganizationMember)
      .where(
        and(
          eq(schema.OrganizationMember.organizationId, organizationId),
          eq(schema.OrganizationMember.status, 'ACTIVE'),
          eq(schema.OrganizationMember.seatType, seatClass)
        )
      )

    activeMemberCount = countRow?.value ?? 0

    if (activeMemberCount >= memberLimit) {
      logger.warn('Invitation acceptance blocked by helper: Seat limit reached.', {
        organizationId,
        acceptingUserId,
        seatType: seatClass,
        limit: memberLimit,
        current: activeMemberCount,
      })
      throw new ForbiddenError(
        isWorkerSeat
          ? `Cannot join organization: The field seat limit (${memberLimit}) for the current plan has been reached.`
          : `Cannot join organization: The member limit (${memberLimit}) for the current plan has been reached.`
      )
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
    throw new ForbiddenError(
      'Cannot join organization: The current plan does not allow additional members.'
    )
  }

  // 2. DB Transaction: Add user, update seats, update invitation
  let newSeatCount = 0
  try {
    const result = await db.transaction(async (tx) => {
      // Carry the invitation's seat packaging onto the new member (§8).
      // §2.A invariant: a field (worker) seat is always the Member role —
      // clamp defensively so a mismatched invitation can never mint a
      // field-seat ADMIN/OWNER even if it slipped past the invite guard.
      const memberSeatType: SeatType = invitation.seatType === 'worker' ? 'worker' : 'full'
      const memberRole: OrganizationRole = memberSeatType === 'worker' ? 'USER' : invitation.role

      // Create new organization member
      const [newMember] = await tx
        .insert(schema.OrganizationMember)
        .values({
          userId: acceptingUserId,
          organizationId: organizationId,
          role: memberRole,
          seatType: memberSeatType,
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
    throw error
  }

  // 3. Update Stripe Subscription Seats (AFTER DB transaction succeeds)
  try {
    const subscription = await db.query.PlanSubscription.findFirst({
      where: (sub, { eq }) => eq(sub.organizationId, organizationId),
      columns: {
        stripeSubscriptionId: true,
        billingProvider: true,
        plan: true,
        billingCycle: true,
      },
    })

    // The seat bump above is provider-agnostic — Shopify bills it via the daily seat-day
    // usage drip (no quantity line). Only push to Stripe for Stripe-billed orgs. Gate on
    // billingProvider explicitly so a stray Stripe id on a Shopify row can't trigger a push.
    if (subscription?.stripeSubscriptionId && subscription.billingProvider !== 'shopify') {
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

        const updateResult = await subscriptionService.updateSubscriptionDirect({
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
  const [user] = await db
    .select({ defaultOrganizationId: schema.User.defaultOrganizationId })
    .from(schema.User)
    .where(eq(schema.User.id, acceptingUserId))
    .limit(1)

  if (!user?.defaultOrganizationId) {
    try {
      await db
        .update(schema.User)
        .set({ defaultOrganizationId: organizationId })
        .where(eq(schema.User.id, acceptingUserId))
      // customSession derives defaultOrganizationId from the cached userProfile — flush the
      // user cache so the new default org is reflected on the next session read.
      const { getUserCache } = await import('../cache')
      await getUserCache().invalidateUser(acceptingUserId)
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
    const { onCacheEvent } = await import('../cache')
    await onCacheEvent('member.added', { orgId: organizationId })
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
export async function acceptInvitation(
  params: {
    token: string
    acceptingUserId: string
    acceptingUserEmail: string | null
  },
  db: Database = database
): Promise<{ success: true; organizationId: string }> {
  const { token, acceptingUserId, acceptingUserEmail } = params
  logger.info('Attempting to accept invitation via token', { token, acceptingUserId })

  if (!acceptingUserEmail) throw new BadRequestError('User email not available.')

  // 1. Find by token and Validate (Existence, Status, Expiry, Email Match)
  const invitation = await db.query.OrganizationInvitation.findFirst({
    where: eq(schema.OrganizationInvitation.token, token),
  })

  if (!invitation) throw new NotFoundError('Invitation not found or invalid.')
  if (invitation.status !== 'PENDING')
    throw new BadRequestError('Invitation has already been used or is no longer valid.')
  if (invitation.expiresAt < new Date()) {
    await db
      .update(schema.OrganizationInvitation)
      .set({ status: 'EXPIRED' })
      .where(eq(schema.OrganizationInvitation.id, invitation.id))
    throw new BadRequestError('Invitation has expired.')
  }
  if (invitation.email.toLowerCase() !== acceptingUserEmail.toLowerCase()) {
    throw new ForbiddenError('This invitation is intended for a different email address.')
  }

  // 2. Check if already member (Token flow: okay if already member, just mark invite accepted)
  const existingMembership = await findMemberByUser(invitation.organizationId, acceptingUserId, db)
  if (existingMembership) {
    logger.warn('User (via token) is already a member', {
      userId: acceptingUserId,
      organizationId: invitation.organizationId,
    })
    // Ensure invite is marked accepted for tracking consistency
    await db
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
  return processInvitationAcceptance(invitation, acceptingUserId, db)
}

/**
 * Accepts an organization invitation (found via INVITATION ID).
 * Verifies the ID, checks email match, existing membership, then processes acceptance.
 */
export async function acceptInvitationById(
  params: {
    invitationId: string
    acceptingUserId: string
    acceptingUserEmail: string | null
  },
  db: Database = database
): Promise<{ success: true; organizationId: string }> {
  const { invitationId, acceptingUserId, acceptingUserEmail } = params
  logger.info('Attempting to accept invitation via identity (ID)', {
    invitationId,
    acceptingUserId,
  })

  if (!acceptingUserEmail) throw new BadRequestError('User email not available.')

  // 1. Find by ID and Validate (Existence, Status, Expiry, Email Match)
  const invitation = await db.query.OrganizationInvitation.findFirst({
    where: eq(schema.OrganizationInvitation.id, invitationId),
  })

  if (!invitation) throw new NotFoundError('Invitation not found or invalid.')
  if (invitation.status !== 'PENDING') {
    // Specific handling for this flow if already accepted by this user
    if (invitation.status === 'ACCEPTED' && invitation.acceptedById === acceptingUserId) {
      throw new BadRequestError('You have already accepted this invitation.')
    }
    throw new BadRequestError('Invitation is no longer valid.')
  }
  if (invitation.expiresAt < new Date()) {
    await db
      .update(schema.OrganizationInvitation)
      .set({ status: 'EXPIRED' })
      .where(eq(schema.OrganizationInvitation.id, invitation.id))
    throw new BadRequestError('Invitation has expired.')
  }
  if (invitation.email.toLowerCase() !== acceptingUserEmail.toLowerCase()) {
    throw new ForbiddenError(
      `This invitation is for ${invitation.email}. Your current logged-in email (${acceptingUserEmail}) does not match.`
    )
  }

  // 2. Check if already member (ID flow: user shouldn't be accepting if already member - Error out)
  const existingMembership = await findMemberByUser(invitation.organizationId, acceptingUserId, db)
  if (existingMembership) {
    logger.warn('User (via ID) is already a member, but trying to accept again.', {
      userId: acceptingUserId,
      organizationId: invitation.organizationId,
    })
    // Mark invite accepted for tracking consistency, but throw error as this indicates a UI issue
    await db
      .update(schema.OrganizationInvitation)
      .set({
        status: 'ACCEPTED',
        acceptedById: acceptingUserId,
        acceptedAt: new Date(),
      })
      .where(eq(schema.OrganizationInvitation.id, invitation.id))
    throw new BadRequestError('You are already a member of this organization.')
  }

  // 3. Delegate to core processing logic
  logger.info('ID invite validated, proceeding to core processing.', {
    invitationId,
    acceptingUserId,
    organizationId: invitation.organizationId,
  })
  return processInvitationAcceptance(invitation, acceptingUserId, db)
}
