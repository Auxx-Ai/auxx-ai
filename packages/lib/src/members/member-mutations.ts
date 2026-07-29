// packages/lib/src/members/member-mutations.ts

import { type Database, database, schema } from '@auxx/database'
import type { SeatType } from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
import { and, count, eq } from 'drizzle-orm'
import { BadRequestError, ForbiddenError, NotFoundError } from '../errors'
import { canManageTarget, requireMemberManage } from './guards'
import { findMemberByUser } from './member-queries'
import { assertSeatAvailable } from './seat-limits'

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
 * Changes a member's seat type (full ⇄ worker/field seat, §2.A/§3.1).
 *
 * - Requires the `members.manage` capability.
 * - Invariant: demoting to a field seat (`'worker'`) requires the member's
 *   role already be USER — admins/owners are always full seats (change the
 *   role first).
 * - Plan limit: an actual class change is hard-blocked when the destination
 *   seat class has no bundled seat left (§4.3), using the same
 *   `assertSeatAvailable` gate as the invite path.
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
    // Plan-limit gate (§4.3) — a seat change consumes a seat of the destination
    // class, so it must pass the same hard block as an invite. The count is
    // scoped to the destination class only; the member still holds a seat of the
    // old class, so they are never double-counted against the limit they are
    // moving into. Skipped entirely on the no-op branch above.
    await assertSeatAvailable({ organizationId, seatType }, db)

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
