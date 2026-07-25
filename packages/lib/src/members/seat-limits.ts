// packages/lib/src/members/seat-limits.ts

import { type Database, database, schema } from '@auxx/database'
import type { SeatType } from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
import { and, count, eq, gt } from 'drizzle-orm'
import { ForbiddenError } from '../errors'
import { FeaturePermissionService } from '../permissions/feature-permission-service'
import { FeatureKey } from '../permissions/types'

const logger = createScopedLogger('member-seat-limits')

/**
 * Plan feature that bundles the given seat class (§2.G). The two classes are
 * billed and bundled independently, so each is counted and capped against its
 * own key — they never cross-consume each other's limit.
 */
export function seatLimitFeature(seatType: SeatType): FeatureKey {
  return seatType === 'worker' ? FeatureKey.workerSeats : FeatureKey.teammates
}

/**
 * Seats consumed by one seat class: active **human** members of that class,
 * optionally plus pending (non-expired) invitations of that class which will
 * consume a seat on acceptance.
 *
 * This is the single seat counter — both the enforcement paths (invite, seat
 * change) and the billing/overage path read it, so they cannot drift apart.
 *
 * Only `userType='USER'` members count. A published agent gets a synthetic
 * `OrganizationMember` (`agent-service.ts:506`) with `status:'ACTIVE'` and no
 * explicit `seatType`, which the column defaults to `'full'` — without this
 * filter every agent would silently consume a paid full seat. `SYSTEM` users
 * have no member row today; excluding them is defensive.
 *
 * The count is always scoped to a single seat class. Callers moving a member
 * between classes therefore never double-count them: the member still holds a
 * seat of the *old* class and so is absent from the destination class's count.
 */
export async function countSeatsUsed(
  params: {
    organizationId: string
    seatType: SeatType
    /** Include PENDING, non-expired invitations of this seat class. */
    includePendingInvitations: boolean
  },
  db: Database = database
): Promise<number> {
  const { organizationId, seatType, includePendingInvitations } = params

  const [memberCount] = await db
    .select({ value: count() })
    .from(schema.OrganizationMember)
    .innerJoin(schema.User, eq(schema.User.id, schema.OrganizationMember.userId))
    .where(
      and(
        eq(schema.OrganizationMember.organizationId, organizationId),
        eq(schema.OrganizationMember.status, 'ACTIVE'),
        eq(schema.OrganizationMember.seatType, seatType),
        eq(schema.User.userType, 'USER')
      )
    )

  if (!includePendingInvitations) return memberCount?.value ?? 0

  const [pendingCount] = await db
    .select({ value: count() })
    .from(schema.OrganizationInvitation)
    .where(
      and(
        eq(schema.OrganizationInvitation.organizationId, organizationId),
        eq(schema.OrganizationInvitation.status, 'PENDING'),
        eq(schema.OrganizationInvitation.seatType, seatType),
        gt(schema.OrganizationInvitation.expiresAt, new Date())
      )
    )

  return (memberCount?.value ?? 0) + (pendingCount?.value ?? 0)
}

/**
 * Hard-blocks an action that would consume a seat of `seatType` when the org
 * has none left (§2.G). Used by the invite path and by the seat-change path —
 * both are admin-facing actions that add a member to a seat class.
 *
 * A negative limit (`-1`) and `'+'`/`true` mean unlimited. `0`/`false` mean the
 * plan bundles none of that class, which is a hard block.
 *
 * **Do not "simplify" this to `FeaturePermissionService.getLimit()`.** That
 * method collapses `0` to `null` (`feature-permission-service.ts:49`), and every
 * caller then reads `null` as "no limit to enforce" — so a plan bundling zero of
 * a class (Demo/Free `workerSeats: 0`) would read as *unlimited*. This reads the
 * raw feature map instead so `0` stays `0` and blocks at the invite rather than
 * letting the invitation through to fail at acceptance.
 */
export async function assertSeatAvailable(
  params: {
    organizationId: string
    seatType: SeatType
  },
  db: Database = database
): Promise<void> {
  const { organizationId, seatType } = params
  const isWorkerSeat = seatType === 'worker'
  const feature = seatLimitFeature(seatType)

  const features = await new FeaturePermissionService(db).getOrganizationFeatures(organizationId)
  if (!features) {
    // No plan data for this org (seeding gap). Don't fail closed here — the
    // accept path still checks before a seat is actually consumed.
    logger.warn('Seat limit check skipped: no plan features for organization', {
      organizationId,
      seatType,
    })
    return
  }

  const limit = features.get(feature)
  // Unlimited / not bundled as a countable limit on this plan.
  if (limit === undefined || limit === true || limit === '+') return
  if (typeof limit === 'number' && limit < 0) return

  const seatLimit = limit === false ? 0 : limit
  const used = await countSeatsUsed(
    { organizationId, seatType, includePendingInvitations: true },
    db
  )

  if (used >= seatLimit) {
    logger.warn('Seat limit reached', { organizationId, seatType, limit: seatLimit, used })
    throw new ForbiddenError(
      isWorkerSeat
        ? `You have reached your field seat limit (${seatLimit}). Upgrade your plan to add more field seats.`
        : `You have reached your team member limit (${seatLimit}). Upgrade your plan to add more teammates.`
    )
  }
}
