// packages/lib/src/permissions/capabilities/compute-user-capabilities.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import type { ResourcePermission } from '@auxx/database/enums'
import { and, eq, inArray, isNull, or } from 'drizzle-orm'
import { composeUserCapabilities, type UserCapabilities } from './compose-user-capabilities'
import { type Area, type Level, parseAreaLevels } from './registry'

/**
 * Compute a member's Layer-2 capabilities for one org: cached memberRoleMap
 * (widened to carry seatType) + cached group memberships + at most ONE
 * PermissionGrant query (skipped entirely for admins and for orgs with zero
 * grants) + ONE type-level ResourceAccess query for `defAccess`.
 *
 * Called only by the `userCapabilities` user-cache provider — read it via
 * `getCachedUserCapabilities(userId, orgId)`, not directly.
 */
export async function computeUserCapabilities(
  userId: string,
  organizationId: string,
  db: Database
): Promise<UserCapabilities> {
  // Lazy import to avoid a hard module cycle (cache providers import this file).
  const { getOrgCache, getCachedUserGroupIds } = await import('../../cache')

  const [roleMap, groupIds, hasGrants] = await Promise.all([
    getOrgCache().get(organizationId, 'memberRoleMap'),
    getCachedUserGroupIds(organizationId, userId),
    getOrgCache().get(organizationId, 'hasPermissionGrants'),
  ])

  const entry = roleMap[userId]
  const role = entry?.role
  const seatType = entry?.seatType ?? 'full'

  // Non-member: fail closed without touching the DB.
  if (!role) return composeUserCapabilities({ role: undefined, seatType, typeAccessRows: [] })

  const isAdmin = role === 'OWNER' || role === 'ADMIN'

  // Grantee set shared by both queries: direct user, org role policy, groups.
  const grantConditions = [
    and(
      eq(schema.PermissionGrant.granteeType, 'user'),
      eq(schema.PermissionGrant.granteeId, userId)
    ),
    and(
      eq(schema.PermissionGrant.granteeType, 'role'),
      eq(schema.PermissionGrant.granteeId, 'org_member')
    ),
  ]
  if (groupIds.length > 0) {
    grantConditions.push(
      and(
        eq(schema.PermissionGrant.granteeType, 'group'),
        inArray(schema.PermissionGrant.granteeId, groupIds)
      )
    )
  }

  const accessConditions = [
    and(eq(schema.ResourceAccess.granteeType, 'user'), eq(schema.ResourceAccess.granteeId, userId)),
    and(
      eq(schema.ResourceAccess.granteeType, 'role'),
      eq(schema.ResourceAccess.granteeId, 'org_member')
    ),
  ]
  if (groupIds.length > 0) {
    accessConditions.push(
      and(
        eq(schema.ResourceAccess.granteeType, 'group'),
        inArray(schema.ResourceAccess.granteeId, groupIds)
      )
    )
  }

  // PermissionGrant query only for non-admins in orgs that actually customized.
  // One sparse-jsonb row per grantee (org policy / group / user).
  const grantRowsPromise =
    isAdmin || !hasGrants
      ? Promise.resolve([] as Array<{ granteeType: string; granteeId: string; levels: unknown }>)
      : db
          .select({
            granteeType: schema.PermissionGrant.granteeType,
            granteeId: schema.PermissionGrant.granteeId,
            levels: schema.PermissionGrant.levels,
          })
          .from(schema.PermissionGrant)
          .where(
            and(eq(schema.PermissionGrant.organizationId, organizationId), or(...grantConditions))
          )

  // Always ONE type-level ResourceAccess query (entityInstanceId IS NULL) for defAccess.
  const typeAccessPromise = db
    .select({
      entityDefinitionId: schema.ResourceAccess.entityDefinitionId,
      permission: schema.ResourceAccess.permission,
    })
    .from(schema.ResourceAccess)
    .where(
      and(
        eq(schema.ResourceAccess.organizationId, organizationId),
        isNull(schema.ResourceAccess.entityInstanceId),
        or(...accessConditions)
      )
    )

  const [grantRows, typeAccessRows] = await Promise.all([grantRowsPromise, typeAccessPromise])

  // Split the sparse-jsonb rows into the three composition tiers (§5).
  let orgPolicyLevels: Partial<Record<Area, Level>> | undefined
  const groupLevels: Array<Partial<Record<Area, Level>>> = []
  let userLevels: Partial<Record<Area, Level>> | undefined
  for (const row of grantRows) {
    const levels = parseAreaLevels(row.levels)
    if (row.granteeType === 'role' && row.granteeId === 'org_member') orgPolicyLevels = levels
    else if (row.granteeType === 'group') groupLevels.push(levels)
    else if (row.granteeType === 'user') userLevels = levels
  }

  return composeUserCapabilities({
    role,
    seatType,
    orgPolicyLevels,
    groupLevels,
    userLevels,
    typeAccessRows: typeAccessRows as Array<{
      entityDefinitionId: string
      permission: ResourcePermission
    }>,
  })
}
