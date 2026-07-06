// packages/lib/src/snippets/snippet-permissions.ts

import { ResourceGranteeType, ResourcePermission } from '@auxx/database/enums'
import { getCachedUserGroupIds } from '../cache'
import type { ResourceAccessInfo } from '../resource-access'

/**
 * Resolve whether `userId` may edit a snippet, given its creator and the
 * already-fetched ResourceAccess grants. Mirrors the duplicated checks that
 * lived in the `byId` and `update` router procedures: creator → direct user
 * EDIT grant → group-membership EDIT grant.
 */
export async function resolveCanEdit(
  organizationId: string,
  userId: string,
  createdById: string,
  shares: ResourceAccessInfo[]
): Promise<boolean> {
  if (createdById === userId) return true
  if (shares.length === 0) return false

  // Direct user EDIT permission
  const userShare = shares.find(
    (s) => s.granteeType === ResourceGranteeType.user && s.granteeId === userId
  )
  if (userShare && userShare.permission === ResourcePermission.edit) {
    return true
  }

  // EDIT permission via group membership
  const groupShares = shares.filter(
    (s) => s.granteeType === ResourceGranteeType.group && s.permission === ResourcePermission.edit
  )
  if (groupShares.length === 0) return false

  const userGroupIds = await getCachedUserGroupIds(organizationId, userId)
  return groupShares.some((s) => userGroupIds.includes(s.granteeId))
}
