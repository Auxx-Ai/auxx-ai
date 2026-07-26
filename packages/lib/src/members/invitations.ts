// packages/lib/src/members/invitations.ts

import { WEBAPP_URL } from '@auxx/config/server'
import { type Database, database, schema } from '@auxx/database'
import type { OrganizationRole, SeatType } from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
import crypto from 'crypto'
import { and, asc, eq, gt, ilike } from 'drizzle-orm'
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../errors'
import { publisher } from '../events'
import { enqueueEmailJob } from '../jobs/email'
import { rankOf, requireMemberManage } from './guards'
import {
  generateAcceptLink,
  generateSignupLink,
  INVITATION_EXPIRATION_HOURS,
} from './invitation-links'
import {
  type InvitableProfile,
  loadInvitableProfile,
  recordInvitationProfileBound,
} from './invitation-profile'
import { findMemberByUser } from './member-queries'
import { assertSeatAvailable } from './seat-limits'

const logger = createScopedLogger('member-service')

/**
 * Invites a user to the organization by creating an invitation record and
 * sending an email, regardless of whether the user already exists.
 */
export async function inviteMember(
  params: {
    organizationId: string
    inviterUserId: string
    inviterName: string | null
    organizationName: string | null
    email: string
    role: OrganizationRole
    /** Seat packaging for the invited member — 'full' (default) or 'worker'
     * (UI "Field seat"). Carried on the invitation row and applied on accept.
     * Ignored when `permissionProfileId` is given: the profile DECLARES its seat
     * class (§0.17) and that declaration is what the cap check must use. */
    seatType?: SeatType
    /** Permission profile chosen in the invite UI. Persisted on the invitation
     * and carried onto the member at acceptance (§1.1) — without it the choice
     * is silently lost, since acceptance otherwise rebuilds the member from
     * `role` + `seatType` alone. Its `seat` drives the seat cap check. */
    permissionProfileId?: string | null
  },
  db: Database = database
): Promise<{ success: true; message: string; existingUser: boolean }> {
  const {
    organizationId,
    inviterUserId,
    inviterName,
    organizationName,
    email,
    role,
    permissionProfileId,
  } = params

  logger.info('Attempting to invite member', {
    organizationId,
    email,
    role,
    seatType: params.seatType,
    permissionProfileId,
    inviterUserId,
  })

  // 1. Check inviter permissions — base members.manage gate + role-relative
  //    escalation guards (§5). A grantee may not mint authority above their own.
  await requireMemberManage(inviterUserId, organizationId, db)
  const inviterMembership = await findMemberByUser(organizationId, inviterUserId, db)
  const inviterRole: OrganizationRole = inviterMembership?.role ?? 'USER'
  if (role === 'OWNER' && inviterRole !== 'OWNER') {
    throw new ForbiddenError('You must be an Owner to perform this action.')
  }
  if (rankOf(role) > rankOf(inviterRole)) {
    throw new ForbiddenError("You don't have permission to invite a member with this role.")
  }

  // 1b. Resolve the chosen profile — AFTER the permission checks, so an
  //     unauthorized caller can never probe which profile ids exist. The profile
  //     is verified to belong to THIS org (a plain FK does not guarantee it) and
  //     to be offerable to a member at all (§1.1), then its declared `seat`
  //     replaces any caller-supplied seat class: the invite UI shows one profile
  //     select, and the cap check below must run on what the profile declares.
  let profile: InvitableProfile | null = null
  if (permissionProfileId) {
    profile = await loadInvitableProfile({ organizationId, permissionProfileId }, db)
  }
  const seatType: SeatType = profile ? profile.seat : (params.seatType ?? 'full')

  // §2.A invariant: a field (worker) seat is always the Member role. Reject a
  // field-seat invite that carries ADMIN/OWNER rather than silently clamping —
  // the caller (form) forces role USER when a field-seat profile is chosen.
  if (seatType === 'worker' && role !== 'USER') {
    throw new BadRequestError(
      'Field seats are limited to the Member role. Invite as a Full member to grant Admin or Owner.'
    )
  }

  // 2. Check if an active user with this email exists (exclude system users)
  const [existingUser] = await db
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
    const existingMember = await findMemberByUser(organizationId, existingUser.id, db)

    if (existingMember) {
      logger.warn('User is already a member', { userId: existingUser.id, organizationId })
      throw new BadRequestError('This user is already a member of the organization.')
    }
  }

  // 4. Check for existing *pending* invitation for this email in THIS organization
  const [existingPendingInvitation] = await db
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
    throw new BadRequestError('An active invitation already exists for this email address.')
  }

  // 5. Check seat limit BEFORE creating invitation (§2.G — hard block, seat-class
  // aware). A field (worker) seat is checked against the workerSeats limit, a full
  // seat against teammates; each class counts only its own active members + pending
  // invitations so the two don't cross-consume each other's bundled limits.
  await assertSeatAvailable({ organizationId, seatType }, db)

  // --- If not already a member and no pending invite, proceed to create invitation ---
  logger.info('Proceeding to create invitation.', {
    email,
    organizationId,
    existingUserId: existingUser?.id,
  })

  // 6. Create the invitation record in the database
  const token = crypto.randomBytes(32).toString('hex')
  const expiresAt = new Date()
  expiresAt.setHours(expiresAt.getHours() + INVITATION_EXPIRATION_HOURS)

  try {
    const [created] = await db
      .insert(schema.OrganizationInvitation)
      .values({
        organizationId,
        email,
        role,
        seatType,
        permissionProfileId: profile?.id ?? null,
        token,
        expiresAt,
        status: 'PENDING',
        invitedById: inviterUserId,
        updatedAt: new Date(),
        // Note: acceptedById remains null until accepted
      })
      .returning({ id: schema.OrganizationInvitation.id })
    logger.info('Organization invitation record created in DB', {
      email,
      organizationId,
      permissionProfileId: profile?.id ?? null,
    })

    // Durable evidence that a binding existed. The FK is `set null`, so deleting
    // the profile before acceptance erases the id from the row — this is what
    // lets acceptance flag the deleted-profile case instead of reading it as
    // "no profile was chosen" (§1.1).
    if (profile && created?.id) {
      await recordInvitationProfileBound({
        organizationId,
        invitationId: created.id,
        invitedById: inviterUserId,
        email,
        profile,
      })
    }
  } catch (dbError: any) {
    logger.error('Failed to create invitation record in DB', {
      email,
      organizationId,
      error: dbError,
    })
    // Handle potential DB errors (e.g., constraints if logic changes)
    if (dbError?.code === '23505' || dbError?.constraint) {
      // Postgres unique constraint violation
      throw new ConflictError('An invitation conflict occurred.')
    }
    throw dbError
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
      await enqueueEmailJob('join-organization', {
        recipient: { email, name: existingUser.name! },
        inviterName: senderName,
        organizationName: orgName,
        role: role.toString(),
        acceptLink,
        invitedUserName: existingUser.name!,
        source: 'member-service',
        organizationId,
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

      await enqueueEmailJob('invite', {
        recipient: { email },
        inviterName: senderName,
        organizationName: orgName,
        role: role.toString(),
        acceptLink: signupLink,
        source: 'member-service',
        organizationId,
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
      await db
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
    throw emailError
  }
}

/**
 * Cancels a pending organization invitation.
 */
export async function cancelInvitation(
  params: {
    invitationId: string
    cancellerUserId: string
    organizationId: string
  },
  db: Database = database
): Promise<{ success: true }> {
  const { invitationId, cancellerUserId, organizationId } = params

  logger.info('Attempting to cancel invitation', {
    invitationId,
    cancellerUserId,
    organizationId,
  })

  // 1. Check canceller permissions within the specified organization
  await requireMemberManage(cancellerUserId, organizationId, db)

  // 2. Find the invitation
  const [invitation] = await db
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
    throw new NotFoundError('Invitation not found.')
  }
  // Ensure the invitation belongs to the organization the canceller has rights in
  if (invitation.organizationId !== organizationId) {
    logger.error('Permission mismatch: Canceller org does not match invitation org', {
      invitationId,
      cancellerOrgId: organizationId,
      inviteOrgId: invitation.organizationId,
    })
    throw new ForbiddenError('You do not have permission to cancel this invitation.')
  }
  if (invitation.status !== 'PENDING') {
    logger.warn('Attempted to cancel non-pending invitation', {
      invitationId,
      status: invitation.status,
    })
    throw new BadRequestError('Only pending invitations can be cancelled.')
  }

  // 4. Update invitation status to CANCELLED
  await db
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
export async function resendInvitation(
  params: {
    invitationId: string
    resenderUserId: string
    organizationId: string
  },
  db: Database = database
): Promise<{ success: true; message: string }> {
  const { invitationId, resenderUserId, organizationId } = params

  logger.info('Attempting to resend invitation', { invitationId, resenderUserId, organizationId })

  // 1. Check resender permissions
  await requireMemberManage(resenderUserId, organizationId, db)

  // 2. Find the invitation and necessary related data for email
  const invitation = await db.query.OrganizationInvitation.findFirst({
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
    throw new NotFoundError('Invitation not found.')
  }
  if (invitation.organizationId !== organizationId) {
    logger.error('Permission mismatch: Resender org does not match invitation org', {
      invitationId,
      resenderOrgId: organizationId,
      inviteOrgId: invitation.organizationId,
    })
    throw new ForbiddenError('You do not have permission to resend this invitation.')
  }
  if (invitation.status !== 'PENDING') {
    logger.warn('Attempted to resend non-pending invitation', {
      invitationId,
      status: invitation.status,
    })
    throw new BadRequestError('Only pending invitations can be resent.')
  }

  // 4. Generate new token and expiry
  const newToken = crypto.randomBytes(32).toString('hex')
  const newExpiresAt = new Date()
  newExpiresAt.setHours(newExpiresAt.getHours() + INVITATION_EXPIRATION_HOURS)

  // 5. Update the invitation record
  try {
    await db
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
    throw dbError
  }

  // 6. Send the email using the NEW token
  const newAcceptLink = generateAcceptLink(newToken)
  const inviterName = invitation.invitedBy?.name || 'A team member' // Use original inviter's name
  const orgName = invitation.organization.name || 'our organization'

  try {
    // Check if the invited email corresponds to an existing user to send correct template
    const existingUser = await db.query.User.findFirst({
      where: and(
        eq(schema.User.email, invitation.email),
        eq(schema.User.userType, 'USER') // Only regular users
      ),
      columns: {
        name: true,
      },
    })

    if (existingUser) {
      await enqueueEmailJob('join-organization', {
        recipient: { email: invitation.email, name: existingUser.name! },
        inviterName,
        organizationName: orgName,
        role: invitation.role.toString(),
        acceptLink: newAcceptLink,
        invitedUserName: existingUser.name!,
        source: 'member-service',
        organizationId: invitation.organizationId,
      })
      logger.info('Resent organization join invitation email (existing user)', {
        invitationId,
        email: invitation.email,
      })
    } else {
      await enqueueEmailJob('invite', {
        recipient: { email: invitation.email },
        inviterName,
        organizationName: orgName,
        role: invitation.role.toString(),
        acceptLink: newAcceptLink,
        source: 'member-service',
        organizationId: invitation.organizationId,
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
    throw emailError
  }
}

/**
 * Retrieves the actual invitation link for a pending invitation.
 * Requires the `members.manage` capability.
 */
export async function getInvitationLink(
  params: {
    invitationId: string
    requestingUserId: string
    organizationId: string // Context for permission check
  },
  db: Database = database
): Promise<string> {
  const { invitationId, requestingUserId, organizationId } = params

  logger.info('Attempting to retrieve invitation link', {
    invitationId,
    requestingUserId,
    organizationId,
  })

  // 1. Check requester permissions within the specified organization
  await requireMemberManage(requestingUserId, organizationId, db)

  // 2. Find the invitation
  const invitation = await db.query.OrganizationInvitation.findFirst({
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
    throw new NotFoundError('Invitation not found.')
  }
  // Ensure the invitation belongs to the organization the requester has rights in
  if (invitation.organizationId !== organizationId) {
    logger.error(
      'Permission mismatch: Requester org does not match invitation org for link retrieval',
      { invitationId, requesterOrgId: organizationId, inviteOrgId: invitation.organizationId }
    )
    throw new ForbiddenError('You do not have permission to access this invitation.')
  }
  if (invitation.status !== 'PENDING') {
    logger.warn('Attempted to get link for non-pending invitation', {
      invitationId,
      status: invitation.status,
    })
    throw new BadRequestError('Links can only be retrieved for pending invitations.')
  }
  if (invitation.expiresAt < new Date()) {
    logger.warn('Attempted to get link for expired invitation', { invitationId })
    throw new BadRequestError('This invitation has expired.')
  }

  // 4. Construct and return the link
  const link = generateAcceptLink(invitation.token)
  logger.info('Invitation link retrieved successfully', { invitationId })
  return link
}

/**
 * Retrieves pending invitations for an organization.
 */
export async function getPendingInvitations(organizationId: string, db: Database = database) {
  return db.query.OrganizationInvitation.findMany({
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
 * Get pending invitations for the current user across all organizations.
 */
export async function getMyPendingInvitations(userEmail: string | null, db: Database = database) {
  if (!userEmail) {
    return []
  }

  return db
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
