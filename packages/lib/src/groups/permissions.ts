// packages/lib/src/groups/permissions.ts

import { and, eq, inArray, or, desc } from 'drizzle-orm'
import { schema } from '@auxx/database'
import { PermissionLevel, GranteeType, MemberType } from '@auxx/database/enums'
import type { GroupContext } from '@auxx/types/groups'
import { satisfiesPermission } from '@auxx/types/groups'
import { ForbiddenError } from '../errors'

/**
 * Get user's permission level on a group
 * Checks org role first (owners/admins get admin), then explicit permissions
 */
export async function getGroupPermission(
  ctx: GroupContext,
  groupId: string
): Promise<PermissionLevel | null> {
  const { db, userId, organizationId } = ctx

  // Check org role first (owners/admins get admin)
  const member = await db.query.OrganizationMember.findFirst({
    where: and(
      eq(schema.OrganizationMember.userId, userId),
      eq(schema.OrganizationMember.organizationId, organizationId)
    ),
    columns: { role: true },
  })

  if (member && ['OWNER', 'ADMIN'].includes(member.role)) {
    return PermissionLevel.admin
  }

  // Get user's teams for team-based permissions (from EntityGroupMember)
  const userTeamMemberships = await db.query.EntityGroupMember.findMany({
    where: and(
      eq(schema.EntityGroupMember.memberType, MemberType.user),
      eq(schema.EntityGroupMember.memberRefId, userId)
    ),
    columns: { groupInstanceId: true },
  })
  const teamIds = userTeamMemberships.map((t) => t.groupInstanceId)

  // Build OR conditions for permission lookup
  const granteeConditions = [
    // Direct user permission
    and(
      eq(schema.EntityGroupPermission.granteeType, GranteeType.user),
      eq(schema.EntityGroupPermission.granteeId, userId)
    ),
    // Role permission (org_member for public groups)
    and(
      eq(schema.EntityGroupPermission.granteeType, GranteeType.role),
      eq(schema.EntityGroupPermission.granteeId, 'org_member')
    ),
  ]

  // Add team permissions if user belongs to any teams
  if (teamIds.length > 0) {
    granteeConditions.push(
      and(
        eq(schema.EntityGroupPermission.granteeType, GranteeType.team),
        inArray(schema.EntityGroupPermission.granteeId, teamIds)
      )
    )
  }

  // Find matching permission with highest level
  const permission = await db.query.EntityGroupPermission.findFirst({
    where: and(eq(schema.EntityGroupPermission.groupInstanceId, groupId), or(...granteeConditions)),
    orderBy: desc(schema.EntityGroupPermission.permission),
  })

  return (permission?.permission as PermissionLevel) ?? null
}

/**
 * Check if user has at least the required permission level
 */
export async function hasGroupPermission(
  ctx: GroupContext,
  groupId: string,
  required: PermissionLevel
): Promise<boolean> {
  const actual = await getGroupPermission(ctx, groupId)
  if (!actual) return false
  return satisfiesPermission(actual, required)
}

/**
 * Assert user has permission, throw ForbiddenError if not
 */
export async function requireGroupPermission(
  ctx: GroupContext,
  groupId: string,
  required: PermissionLevel
): Promise<void> {
  const hasIt = await hasGroupPermission(ctx, groupId, required)
  if (!hasIt) {
    throw new ForbiddenError(`Missing '${required}' permission on group`)
  }
}
