// packages/lib/src/members/member-mutations.ts

import { type Database, database, schema } from '@auxx/database'
import type { OrganizationRole, SeatType } from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
import { and, count, eq } from 'drizzle-orm'
import { BadRequestError, ForbiddenError, NotFoundError } from '../errors'
import { canManageTarget, rankOf, requireMemberManage } from './guards'
import { findMemberByUser } from './member-queries'

const logger = createScopedLogger('member-service')

/**
 * Removes a member from the organization.
 */
export async function removeMember(
  params: {
    organizationId: string
    removerUserId: string
    memberToRemoveId: string
  },
  db: Database = database
): Promise<{ success: true }> {
  const { organizationId, removerUserId, memberToRemoveId } = params

  logger.info('Attempting to remove member', { organizationId, memberToRemoveId, removerUserId })

  // 1. Base gate — the actor must hold `members.manage`.
  await requireMemberManage(removerUserId, organizationId, db)

  const removerMembership = await findMemberByUser(organizationId, removerUserId, db)
  if (!removerMembership) {
    throw new ForbiddenError('You are not a member of this organization.')
  }

  // 2. Get the membership of the user to be removed
  const targetMembership = await findMemberByUser(organizationId, memberToRemoveId, db)
  if (!targetMembership) {
    throw new NotFoundError('Member not found in this organization.')
  }

  // 3. Apply role-relative escalation guards (§5.2)
  if (removerUserId === memberToRemoveId) {
    throw new BadRequestError("You cannot remove yourself. Use 'Leave Organization' instead.")
  }
  if (!canManageTarget(removerMembership.role, targetMembership.role)) {
    logger.warn('Permission denied for removing member', {
      removerRole: removerMembership.role,
      targetRole: targetMembership.role,
      removerUserId,
      memberToRemoveId,
    })
    throw new ForbiddenError("You don't have permission to remove this member.")
  }
  // Prevent removing the last owner
  if (targetMembership.role === 'OWNER') {
    const [ownerCount] = await db
      .select({ value: count() })
      .from(schema.OrganizationMember)
      .where(
        and(
          eq(schema.OrganizationMember.organizationId, organizationId),
          eq(schema.OrganizationMember.role, 'OWNER')
        )
      )

    if ((ownerCount?.value ?? 0) <= 1) {
      throw new BadRequestError('Cannot remove the only owner. Transfer ownership first.')
    }
  }

  // 4. Remove the member
  await db
    .delete(schema.OrganizationMember)
    .where(eq(schema.OrganizationMember.id, targetMembership.id))

  // Offboarding (mail-permissions §11.4): stop sync on the removed member's
  // personal channels. The inbox + threads keep personal visibility; admins
  // claim or delete the orphaned inbox explicitly. Lazy import — channels
  // pulls the provider stack, members must not load it eagerly.
  try {
    const { disconnectPersonalChannelsForUser } = await import('../channels/personal-connection')
    await disconnectPersonalChannelsForUser(organizationId, memberToRemoveId)
  } catch (error) {
    logger.error('Failed to disconnect personal channels for removed member', {
      organizationId,
      memberToRemoveId,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  logger.info('Member removed successfully', { organizationId, memberToRemoveId, removerUserId })
  return { success: true }
}

/**
 * Updates a member's role within the organization.
 */
export async function updateMemberRole(
  params: {
    organizationId: string
    updaterUserId: string
    memberToUpdateId: string
    newRole: OrganizationRole
  },
  db: Database = database
): Promise<{ success: true }> {
  const { organizationId, updaterUserId, memberToUpdateId, newRole } = params

  logger.info('Attempting to update member role', {
    organizationId,
    memberToUpdateId,
    newRole,
    updaterUserId,
  })

  // 1. Base gate — the actor must hold `members.manage`.
  await requireMemberManage(updaterUserId, organizationId, db)

  const updaterMembership = await findMemberByUser(organizationId, updaterUserId, db)
  if (!updaterMembership) {
    throw new ForbiddenError('You are not a member of this organization.')
  }

  // 2. Get the membership of the user being updated
  const targetMembership = await findMemberByUser(organizationId, memberToUpdateId, db)
  if (!targetMembership) {
    throw new NotFoundError('Member not found.')
  }

  // §2.A invariant: a field (worker) seat can never hold ADMIN/OWNER authority
  // (`seatType='worker'` ⇒ `role='USER'`). The seat type must be switched to
  // 'full' before the member can be promoted.
  if (targetMembership.seatType === 'worker' && newRole !== 'USER') {
    throw new BadRequestError(
      'This member holds a field seat, which is limited to the Member role. ' +
        "Change their seat type to 'full' before promoting them to Admin or Owner."
    )
  }

  // Cannot update own role
  if (updaterUserId === memberToUpdateId) {
    throw new BadRequestError('You cannot change your own role.')
  }

  // 3. Role-relative escalation guards (§5.2)
  // Owner-only lever: only an OWNER may promote to OWNER or touch an OWNER.
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
    throw new ForbiddenError('Only Owners can manage Owner roles.')
  }
  // Admin peers cannot change each other's role.
  if (updaterMembership.role === 'ADMIN' && targetMembership.role === 'ADMIN') {
    throw new ForbiddenError('Admins cannot change the role of other Admins.')
  }
  // Rank guard: an actor may only act on a manageable target and may not mint a
  // role above their own rank (blocks a USER-rank `members.manage` grantee from
  // touching ADMIN/OWNER or promoting anyone above USER).
  if (
    !canManageTarget(updaterMembership.role, targetMembership.role) ||
    rankOf(newRole) > rankOf(updaterMembership.role)
  ) {
    logger.warn('Permission denied for updating roles', {
      updaterRole: updaterMembership.role,
      updaterUserId,
    })
    throw new ForbiddenError("You don't have permission to update member roles.")
  }

  // 4. Prevent removing the last owner by changing their role
  if (targetMembership.role === 'OWNER' && newRole !== 'OWNER') {
    const [ownerCount] = await db
      .select({ value: count() })
      .from(schema.OrganizationMember)
      .where(
        and(
          eq(schema.OrganizationMember.organizationId, organizationId),
          eq(schema.OrganizationMember.role, 'OWNER')
        )
      )

    if ((ownerCount?.value ?? 0) <= 1) {
      logger.warn('Attempted to change role of the last owner', {
        organizationId,
        memberToUpdateId,
      })
      throw new BadRequestError(
        'Cannot change the role of the only Owner. Transfer ownership first.'
      )
    }
  }

  // 5. Update the role
  await db
    .update(schema.OrganizationMember)
    .set({ role: newRole, updatedAt: new Date() })
    .where(eq(schema.OrganizationMember.id, targetMembership.id))

  // Recompose caches + nudge the client: a role change shifts the member's
  // composed capability set (role defaults). Mirrors the seat-type path.
  const { onCacheEvent } = await import('../cache')
  await onCacheEvent('member.role.changed', {
    orgId: organizationId,
    userId: memberToUpdateId,
  })
  const { DehydrationCacheService } = await import('../dehydration/cache')
  await new DehydrationCacheService().invalidateUser(memberToUpdateId)
  // UX-only live merge for the affected member's open clients.
  const { getRealtimeService, publishCapabilitiesChanged } = await import('../realtime')
  await publishCapabilitiesChanged(getRealtimeService(), { userId: memberToUpdateId })

  logger.info('Member role updated successfully', {
    organizationId,
    memberToUpdateId,
    newRole,
    updaterUserId,
  })
  return { success: true }
}

/**
 * Changes a member's seat type (full ⇄ worker/field seat, §2.A/§3.1).
 *
 * - Requires the `members.manage` capability.
 * - Invariant: demoting to a field seat (`'worker'`) requires the member's
 *   role already be USER — admins/owners are always full seats (change the
 *   role first).
 *
 * On success the seat type is persisted and, mirroring the `member.added`
 * emit path, `member.seat-type.changed` is fired and the member's dehydrated
 * state is invalidated so their capability set + ceiling clamp recompose on
 * the next request. Lazy imports keep the members module off the cache /
 * dehydration stacks at load time.
 */
export async function updateMemberSeatType(
  params: {
    organizationId: string
    updaterUserId: string
    memberToUpdateId: string
    seatType: SeatType
  },
  db: Database = database
): Promise<{ success: true }> {
  const { organizationId, updaterUserId, memberToUpdateId, seatType } = params

  logger.info('Attempting to update member seat type', {
    organizationId,
    memberToUpdateId,
    seatType,
    updaterUserId,
  })

  // 1. Base gate — the actor must hold `members.manage`.
  await requireMemberManage(updaterUserId, organizationId, db)

  // 2. Load the target membership.
  const targetMembership = await findMemberByUser(organizationId, memberToUpdateId, db)
  if (!targetMembership) {
    throw new NotFoundError('Member not found.')
  }

  // 3. Invariant: a field seat implies role USER. An ADMIN/OWNER must be
  //    demoted to USER before they can take a field seat.
  if (seatType === 'worker' && targetMembership.role !== 'USER') {
    throw new BadRequestError(
      'Only members with the Member role can be moved to a field seat. ' +
        'Change their role to Member first.'
    )
  }

  // 4. Persist (no-op when unchanged) and recompose caches.
  if (targetMembership.seatType !== seatType) {
    await db
      .update(schema.OrganizationMember)
      .set({ seatType, updatedAt: new Date() })
      .where(
        and(
          eq(schema.OrganizationMember.organizationId, organizationId),
          eq(schema.OrganizationMember.userId, memberToUpdateId)
        )
      )

    const { onCacheEvent } = await import('../cache')
    await onCacheEvent('member.seat-type.changed', {
      orgId: organizationId,
      userId: memberToUpdateId,
    })
    const { DehydrationCacheService } = await import('../dehydration/cache')
    await new DehydrationCacheService().invalidateUser(memberToUpdateId)
    // UX-only live merge — the seat ceiling changed this member's composed set.
    const { getRealtimeService, publishCapabilitiesChanged } = await import('../realtime')
    await publishCapabilitiesChanged(getRealtimeService(), { userId: memberToUpdateId })
  }

  logger.info('Member seat type updated successfully', {
    organizationId,
    memberToUpdateId,
    seatType,
    updaterUserId,
  })
  return { success: true }
}
