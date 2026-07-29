// packages/lib/src/members/assign-profile.ts

import { type Database, database, schema } from '@auxx/database'
import type { OrganizationRole } from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
import { and, count, eq } from 'drizzle-orm'
import { BadRequestError, ForbiddenError, NotFoundError } from '../errors'
import { PermissionKey } from '../permissions/capabilities/registry'
import { requirePermission } from '../permissions/capabilities/require'
// Deep imports, not the `../permissions/profiles` barrel: the barrel pulls the
// agent-policy + profile-invalidation stack (cache, realtime) into a module that
// only needs the §6.1 guard and the state it compares.
import { computeEffectiveStatesUncached } from '../permissions/profiles/effective-state'
import { type ActorAuthority, assertNoEscalation } from '../permissions/profiles/escalation-guard'
import { canManageTarget, rankOf, requireMemberManage } from './guards'
import { loadInvitableProfile } from './invitation-profile'
import { findMemberByUser } from './member-queries'

const logger = createScopedLogger('member-service')

/** What one assignment writes onto `OrganizationMember` (plan 21 §3.2). */
export interface AssignMemberProfileParams {
  organizationId: string
  /** Who is assigning — their rank AND their effective state bound the write. */
  actorUserId: string
  /** The target member's `userId` — the id every other `member.*` mutation takes. */
  memberUserId: string
  /** Profile to bind, or `null` to fall back to the system template (§1.3). */
  permissionProfileId: string | null
}

/** The member's resulting binding — the rank is the profile's DECLARED role. */
export interface AssignMemberProfileResult {
  success: true
  permissionProfileId: string | null
  role: OrganizationRole
  /**
   * The rank the member held before this assignment. Assignment is the only
   * path that writes a rank, so this is what makes a promotion or demotion
   * visible in the audit trail — the caller records it as `previousState`.
   * Equal to `role` when the binding changed but the declared rank did not.
   */
  previousRole: OrganizationRole
}

/**
 * Bind a permission profile to a member, writing the member's rank from the
 * profile's declared `role` (plan 21 §2.a.3).
 *
 * Assignment is a **role write**, and since the standalone role mutation was
 * removed it is the ONLY one — so every guard that path owned lives here (§7).
 * Missing one turns the profile picker into a privilege-escalation control.
 * In order:
 *
 * 1. `members.manage` **and** `permissions.manage` (a profile is an access shape,
 *    so assigning one is a permissions write as much as a member write).
 * 2. The profile is org-scoped, admits members, and is never the Owner profile —
 *    assigning that one is an ownership transfer and deserves its own action
 *    (§2.a.9).
 * 3. A cross-seat assignment is **refused, never migrated**: seats are a billing
 *    event and assignment is not one (§2.a.4).
 * 4. `worker ⇒ USER` stays as a server invariant even though §2.0.1 makes it
 *    unauthorable from any UI.
 * 5. No self-service, the Owner-only lever, the admin-peer refusal, and the
 *    `canManageTarget` + `rankOf` rank guard — the last run against the
 *    profile's DECLARED role, not the caller's wish.
 * 6. Last-owner protection — reassigning the only Owner off Owner rank fails
 *    with the same message the remove-member path uses.
 * 7. The doc 19 §6.1 escalation guard over the member's **resulting effective
 *    state**, snapshotted before and after the write inside one transaction, so
 *    a refusal rolls the binding back.
 *
 * `seatType` is NEVER written. Unbinding (`permissionProfileId: null`) leaves the
 * rank untouched — the system template a null binding resolves to is derived from
 * the role the member already holds — but still runs the escalation guard,
 * because dropping a restrictive profile can widen the member.
 *
 * @throws ForbiddenError / BadRequestError / NotFoundError per the guard list.
 */
export async function assignMemberProfile(
  params: AssignMemberProfileParams,
  db: Database = database
): Promise<AssignMemberProfileResult> {
  const { organizationId, actorUserId, memberUserId, permissionProfileId } = params

  logger.info('Attempting to assign permission profile', {
    organizationId,
    memberUserId,
    permissionProfileId,
    actorUserId,
  })

  // 1. Base gates FIRST — an unauthorized caller can never probe which profile
  //    ids exist. `members.manage` is the member-write gate; `permissions.manage`
  //    is the access-shape gate, and assignment is both (§7 row 1).
  await requireMemberManage(actorUserId, organizationId, db)
  await requirePermission(actorUserId, organizationId, PermissionKey.permissionsManage, db)

  const actorMembership = await findMemberByUser(organizationId, actorUserId, db)
  if (!actorMembership) {
    throw new ForbiddenError('You are not a member of this organization.')
  }

  const targetMembership = await findMemberByUser(organizationId, memberUserId, db)
  if (!targetMembership) {
    throw new NotFoundError('Member not found.')
  }

  // 2. No self-service: an actor cannot re-shape their own access.
  if (actorUserId === memberUserId) {
    throw new BadRequestError('You cannot change your own permission profile.')
  }

  // 3. Resolve the profile. `loadInvitableProfile` already enforces org scope (a
  //    plain FK does not) and refuses an agent-only profile; the Owner profile is
  //    refused here (§2.a.9 — assigning it is an ownership transfer).
  const profile = permissionProfileId
    ? await loadInvitableProfile({ organizationId, permissionProfileId }, db)
    : null

  if (profile?.slug === 'owner') {
    throw new ForbiddenError(
      'The Owner profile cannot be assigned. Transferring ownership is a separate action.'
    )
  }

  // 4. Cross-seat refusal (§2.a.4). A seat change is a billing event; assignment
  //    is not one, so a mismatch is refused rather than migrated — and it must
  //    not fall through to a seat cap check either.
  if (profile && profile.seat !== targetMembership.seatType) {
    throw new BadRequestError(
      `This profile is for a ${profile.seat === 'worker' ? 'field' : 'full'} seat and this ` +
        'member holds the other seat class. Change their seat type first — assignment never ' +
        'changes a seat.'
    )
  }

  // Snapshot the rank BEFORE the write. `targetMembership` may alias the row the
  // update mutates, so reading it after the transaction can report the new rank
  // as the old one — which would silently make every audit row claim no rank
  // change occurred.
  const previousRole: OrganizationRole = targetMembership.role

  // The rank the member will actually hold. Guarding anything else would let a
  // profile-declared rank slip past the guards below (plan 21 §2.a.3).
  const nextRole: OrganizationRole = profile ? profile.role : previousRole

  // 5. §2.A invariant: a field (worker) seat can never hold ADMIN/OWNER
  //    authority. Unreachable from the UI (§3.5 makes such a profile
  //    unauthorable) — kept so a direct API caller cannot mint it either.
  if (targetMembership.seatType === 'worker' && nextRole !== 'USER') {
    throw new BadRequestError(
      'This member holds a field seat, which is limited to the Member role. ' +
        "Change their seat type to 'full' before granting Admin or Owner rank."
    )
  }

  // 6. Role-relative escalation guards (§5.2).
  //    Owner-only lever: only an OWNER may grant OWNER rank or touch an OWNER.
  if (
    actorMembership.role !== 'OWNER' &&
    (nextRole === 'OWNER' || targetMembership.role === 'OWNER')
  ) {
    logger.warn('Permission denied for assigning a profile to/from an Owner', {
      actorRole: actorMembership.role,
      targetRole: targetMembership.role,
      nextRole,
      actorUserId,
      memberUserId,
    })
    throw new ForbiddenError('Only Owners can manage Owner roles.')
  }
  // Admin peers cannot re-shape each other.
  if (actorMembership.role === 'ADMIN' && targetMembership.role === 'ADMIN') {
    throw new ForbiddenError('Admins cannot change the permission profile of other Admins.')
  }
  // Rank guard: a manageable target, and no minting a rank above the actor's own
  // (blocks a USER-rank `members.manage` grantee from assigning the Admin profile).
  if (
    !canManageTarget(actorMembership.role, targetMembership.role) ||
    rankOf(nextRole) > rankOf(actorMembership.role)
  ) {
    logger.warn('Permission denied for assigning a permission profile', {
      actorRole: actorMembership.role,
      nextRole,
      actorUserId,
    })
    throw new ForbiddenError("You don't have permission to assign this permission profile.")
  }

  // 7. Last-owner protection — reassigning the only Owner off Owner rank must
  //    fail identically to the remove-member path's last-owner check.
  if (targetMembership.role === 'OWNER' && nextRole !== 'OWNER') {
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
      logger.warn('Attempted to reassign the last owner', { organizationId, memberUserId })
      throw new BadRequestError(
        'Cannot change the role of the only Owner. Transfer ownership first.'
      )
    }
  }

  // 8. Write + the §6.1 guard over the RESULTING effective state, in one
  //    transaction. `before` is the member under their current profile, `after`
  //    the member under the new one; the actor's authority is their PRE-write
  //    state so an assignment can never authorize itself. Both snapshots come
  //    from `computeEffectiveStatesUncached` — composing `after` through the org
  //    cache would return pre-write values and the guard would always pass.
  await db.transaction(async (tx) => {
    const before = await computeEffectiveStatesUncached({
      organizationId,
      userIds: [memberUserId, actorUserId],
      tx,
    })
    const actorState = before.get(actorUserId)
    if (!actorState) throw new ForbiddenError('You are not a member of this organization.')
    const actor: ActorAuthority = {
      userId: actorUserId,
      role: actorMembership.role,
      state: actorState,
    }

    await tx
      .update(schema.OrganizationMember)
      .set({ permissionProfileId, role: nextRole, updatedAt: new Date() })
      .where(eq(schema.OrganizationMember.id, targetMembership.id))

    const after = await computeEffectiveStatesUncached({
      organizationId,
      userIds: [memberUserId],
      tx,
    })
    // ForbiddenError → the transaction rolls the binding back.
    assertNoEscalation({ actor, before, after })
  })

  // Recompose caches + nudge the client: the binding AND the rank both shift the
  // member's composed capability set. Same tail as the seat-type path; lazy
  // imports keep members off the cache / dehydration / realtime stacks at load.
  const { onCacheEvent } = await import('../cache')
  await onCacheEvent('member.role.changed', { orgId: organizationId, userId: memberUserId })
  const { DehydrationCacheService } = await import('../dehydration/cache')
  await new DehydrationCacheService().invalidateUser(memberUserId)
  // UX-only live merge for the affected member's open clients.
  const { getRealtimeService, publishCapabilitiesChanged } = await import('../realtime')
  await publishCapabilitiesChanged(getRealtimeService(), { userId: memberUserId })

  logger.info('Permission profile assigned', {
    organizationId,
    memberUserId,
    permissionProfileId,
    role: nextRole,
    actorUserId,
  })

  return {
    success: true,
    permissionProfileId,
    role: nextRole,
    previousRole,
  }
}
