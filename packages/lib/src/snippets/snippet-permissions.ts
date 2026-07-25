// packages/lib/src/snippets/snippet-permissions.ts

import { ResourceGranteeType, ResourcePermission } from '@auxx/database/enums'
import { getCachedUserGroupIds } from '../cache'
import type { ResourceAccessInfo } from '../resource-access'
import { resolveUserProfileId } from '../resource-access/grantee-resolution'

/**
 * Resolve whether `userId` may edit a snippet, given its creator and the
 * already-fetched ResourceAccess grants. Mirrors the duplicated checks that
 * lived in the `byId` and `update` router procedures: creator → direct user
 * EDIT grant → permission-profile EDIT grant → group-membership EDIT grant.
 *
 * The profile branch was added in doc 19 step 9 (19a #12). Snippets read grants
 * through {@link ResourceAccessInfo} rather than a SQL grantee union, so the
 * shared `resourceAccessGranteeConditions` builder doesn't apply — the filter
 * happens in memory here instead, and must be kept in step with it.
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

  const editShares = shares.filter((s) => s.permission === ResourcePermission.edit)

  // EDIT permission via the user's bound permission profile. Resolved through
  // the same `resolveBaseProfile` the capability composer uses, so a null-bound
  // member is reached by a grant on their system profile.
  const profileShares = editShares.filter((s) => s.granteeType === ResourceGranteeType.profile)
  if (profileShares.length > 0) {
    const profileId = await resolveUserProfileId(organizationId, userId)
    if (profileId && profileShares.some((s) => s.granteeId === profileId)) return true
  }

  // EDIT permission via group membership
  const groupShares = editShares.filter((s) => s.granteeType === ResourceGranteeType.group)
  if (groupShares.length === 0) return false

  const userGroupIds = await getCachedUserGroupIds(organizationId, userId)
  return groupShares.some((s) => userGroupIds.includes(s.granteeId))
}
