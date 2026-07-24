// packages/lib/src/members/guards.ts

import type { Database } from '@auxx/database'
import type { OrganizationRole } from '@auxx/database/types'
import { PermissionKey } from '../permissions/capabilities/registry'
import { requirePermission } from '../permissions/capabilities/require'

/**
 * Base gate for every member-management write (invite/remove/role/seat/cancel/
 * resend/link). Runs the Layer-1 plan-AND + Layer-2 `members.manage` assert.
 *
 * ADMIN/OWNER hold `members.manage` via role defaults, so existing admin flows
 * are unchanged; a plain USER granted `members.manage` now passes too. The
 * grantee's authority is still bounded by the role-relative rank guards below.
 */
export async function requireMemberManage(
  userId: string,
  organizationId: string,
  db?: Database
): Promise<void> {
  await requirePermission(userId, organizationId, PermissionKey.membersManage, db)
}

/** Authority rank per role — higher acts on lower (§5.2). */
export const ROLE_RANK: Record<OrganizationRole, number> = { OWNER: 3, ADMIN: 2, USER: 1 }

/** Numeric authority rank of a role. */
export function rankOf(role: OrganizationRole): number {
  return ROLE_RANK[role]
}

/**
 * Whether an actor with `actorRole` may remove/demote a member with
 * `targetRole` (§5.2 role-relative escalation guards, not the admin binary):
 *
 * - OWNER may act on anyone (last-owner protection is enforced separately).
 * - Only OWNER may act on an OWNER.
 * - ADMIN peers cannot act on each other.
 * - Otherwise the target's rank must be ≤ the actor's — so an ADMIN acts on
 *   USER, and a `members.manage` grantee (role USER, rank 1) acts only on other
 *   USER-rank members.
 */
export function canManageTarget(
  actorRole: OrganizationRole,
  targetRole: OrganizationRole
): boolean {
  if (actorRole === 'OWNER') return true
  if (targetRole === 'OWNER') return false
  if (actorRole === 'ADMIN' && targetRole === 'ADMIN') return false
  return rankOf(targetRole) <= rankOf(actorRole)
}
