// packages/lib/src/resource-access/resource-access-service.ts

import { schema } from '@auxx/database'
import { MemberType, ResourceGranteeType, ResourcePermission } from '@auxx/database/enums'
import type { RecordId } from '@auxx/types/resource'
import { parseRecordId, toRecordId } from '@auxx/types/resource'
import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm'
import { satisfiesPermission } from './constants'
import type {
  AccessCheckResult,
  CheckAccessInput,
  CheckTypeAccessInput,
  GrantInstanceAccessInput,
  GrantTypeAccessInput,
  InstanceAccess,
  ResourceAccessContext,
  ResourceAccessInfo,
  RevokeInstanceAccessInput,
  RevokeTypeAccessInput,
} from './types'

/**
 * Grant access to a specific entity instance.
 */
export async function grantInstanceAccess(
  ctx: ResourceAccessContext,
  input: GrantInstanceAccessInput
): Promise<void> {
  const { db, organizationId, userId } = ctx
  const { entityDefinitionId, entityInstanceId } = parseRecordId(input.recordId)

  await db
    .insert(schema.ResourceAccess)
    .values({
      organizationId,
      entityDefinitionId,
      entityInstanceId,
      granteeType: input.granteeType,
      granteeId: input.granteeId,
      permission: input.permission,
      grantedById: userId,
    })
    .onConflictDoUpdate({
      target: [
        schema.ResourceAccess.organizationId,
        schema.ResourceAccess.entityDefinitionId,
        schema.ResourceAccess.entityInstanceId,
        schema.ResourceAccess.granteeType,
        schema.ResourceAccess.granteeId,
      ],
      set: {
        permission: input.permission,
        grantedById: userId,
        updatedAt: new Date(),
      },
    })
}

/**
 * Grant type-level access (access to ALL instances of an entity type).
 */
export async function grantTypeAccess(
  ctx: ResourceAccessContext,
  input: GrantTypeAccessInput
): Promise<void> {
  const { db, organizationId, userId } = ctx

  await db
    .insert(schema.ResourceAccess)
    .values({
      organizationId,
      entityDefinitionId: input.entityDefinitionId,
      entityInstanceId: null,
      granteeType: input.granteeType,
      granteeId: input.granteeId,
      permission: input.permission,
      grantedById: userId,
    })
    .onConflictDoUpdate({
      target: [
        schema.ResourceAccess.organizationId,
        schema.ResourceAccess.entityDefinitionId,
        schema.ResourceAccess.entityInstanceId,
        schema.ResourceAccess.granteeType,
        schema.ResourceAccess.granteeId,
      ],
      set: {
        permission: input.permission,
        grantedById: userId,
        updatedAt: new Date(),
      },
    })
}

/**
 * Revoke access to a specific entity instance.
 */
export async function revokeInstanceAccess(
  ctx: ResourceAccessContext,
  input: RevokeInstanceAccessInput
): Promise<boolean> {
  const { db, organizationId } = ctx
  const { entityDefinitionId, entityInstanceId } = parseRecordId(input.recordId)

  const result = await db
    .delete(schema.ResourceAccess)
    .where(
      and(
        eq(schema.ResourceAccess.organizationId, organizationId),
        eq(schema.ResourceAccess.entityDefinitionId, entityDefinitionId),
        eq(schema.ResourceAccess.entityInstanceId, entityInstanceId),
        eq(schema.ResourceAccess.granteeType, input.granteeType),
        eq(schema.ResourceAccess.granteeId, input.granteeId)
      )
    )
    .returning()

  return result.length > 0
}

/**
 * Revoke type-level access.
 */
export async function revokeTypeAccess(
  ctx: ResourceAccessContext,
  input: RevokeTypeAccessInput
): Promise<boolean> {
  const { db, organizationId } = ctx

  const result = await db
    .delete(schema.ResourceAccess)
    .where(
      and(
        eq(schema.ResourceAccess.organizationId, organizationId),
        eq(schema.ResourceAccess.entityDefinitionId, input.entityDefinitionId),
        isNull(schema.ResourceAccess.entityInstanceId),
        eq(schema.ResourceAccess.granteeType, input.granteeType),
        eq(schema.ResourceAccess.granteeId, input.granteeId)
      )
    )
    .returning()

  return result.length > 0
}

/**
 * Set instance-level access grants (replace all existing grants for a grantee type on this instance).
 */
export async function setInstanceAccess(
  ctx: ResourceAccessContext,
  recordId: RecordId,
  granteeType: ResourceGranteeType,
  grants: Array<{ granteeId: string; permission: ResourcePermission }>
): Promise<void> {
  const { db, organizationId, userId } = ctx
  const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)

  await db.transaction(async (tx: typeof db) => {
    // Remove existing grants of this type for this instance
    await tx
      .delete(schema.ResourceAccess)
      .where(
        and(
          eq(schema.ResourceAccess.organizationId, organizationId),
          eq(schema.ResourceAccess.entityDefinitionId, entityDefinitionId),
          eq(schema.ResourceAccess.entityInstanceId, entityInstanceId),
          eq(schema.ResourceAccess.granteeType, granteeType)
        )
      )

    // Insert new grants
    if (grants.length > 0) {
      await tx.insert(schema.ResourceAccess).values(
        grants.map((g) => ({
          organizationId,
          entityDefinitionId,
          entityInstanceId,
          granteeType,
          granteeId: g.granteeId,
          permission: g.permission,
          grantedById: userId,
        }))
      )
    }
  })
}

/**
 * Set type-level access grants (replace all existing grants for a grantee type on this entity type).
 */
export async function setTypeAccess(
  ctx: ResourceAccessContext,
  entityDefinitionId: string,
  granteeType: ResourceGranteeType,
  grants: Array<{ granteeId: string; permission: ResourcePermission }>
): Promise<void> {
  const { db, organizationId, userId } = ctx

  await db.transaction(async (tx: typeof db) => {
    // Remove existing type-level grants of this type
    await tx
      .delete(schema.ResourceAccess)
      .where(
        and(
          eq(schema.ResourceAccess.organizationId, organizationId),
          eq(schema.ResourceAccess.entityDefinitionId, entityDefinitionId),
          isNull(schema.ResourceAccess.entityInstanceId),
          eq(schema.ResourceAccess.granteeType, granteeType)
        )
      )

    // Insert new grants
    if (grants.length > 0) {
      await tx.insert(schema.ResourceAccess).values(
        grants.map((g) => ({
          organizationId,
          entityDefinitionId,
          entityInstanceId: null,
          granteeType,
          granteeId: g.granteeId,
          permission: g.permission,
          grantedById: userId,
        }))
      )
    }
  })
}

/**
 * Check if a user has access to a specific entity instance.
 * Checks both instance-level and type-level grants.
 */
export async function checkAccess(
  ctx: ResourceAccessContext,
  input: CheckAccessInput
): Promise<AccessCheckResult> {
  const { db, organizationId } = ctx
  const { entityDefinitionId, entityInstanceId } = parseRecordId(input.recordId)
  const targetUserId = input.userId

  // 1. Check if user is org admin (has access to everything)
  const member = await db.query.OrganizationMember.findFirst({
    where: and(
      eq(schema.OrganizationMember.userId, targetUserId),
      eq(schema.OrganizationMember.organizationId, organizationId)
    ),
    columns: { role: true },
  })

  if (member && ['OWNER', 'ADMIN'].includes(member.role)) {
    return {
      hasAccess: true,
      permission: ResourcePermission.admin,
      grantedVia: 'role',
      accessLevel: 'type',
    }
  }

  // 2. Get user's groups (for group-based access)
  const userGroups = await db.query.EntityGroupMember.findMany({
    where: and(
      eq(schema.EntityGroupMember.memberType, MemberType.user),
      eq(schema.EntityGroupMember.memberRefId, targetUserId)
    ),
    columns: { groupInstanceId: true },
  })
  const groupIds = userGroups.map((g: { groupInstanceId: string }) => g.groupInstanceId)

  // 3. Build grantee conditions
  const granteeConditions = [
    // Direct user grant
    and(
      eq(schema.ResourceAccess.granteeType, ResourceGranteeType.user),
      eq(schema.ResourceAccess.granteeId, targetUserId)
    ),
    // Role grant (org_member)
    and(
      eq(schema.ResourceAccess.granteeType, ResourceGranteeType.role),
      eq(schema.ResourceAccess.granteeId, 'org_member')
    ),
  ]

  // Group grants (if user belongs to any groups)
  if (groupIds.length > 0) {
    granteeConditions.push(
      and(
        eq(schema.ResourceAccess.granteeType, ResourceGranteeType.group),
        inArray(schema.ResourceAccess.granteeId, groupIds)
      )
    )
  }

  // 4. Find matching access grants (both instance-level and type-level)
  const grants = await db.query.ResourceAccess.findMany({
    where: and(
      eq(schema.ResourceAccess.organizationId, organizationId),
      eq(schema.ResourceAccess.entityDefinitionId, entityDefinitionId),
      // Match either this specific instance OR type-level (null instance)
      or(
        eq(schema.ResourceAccess.entityInstanceId, entityInstanceId),
        isNull(schema.ResourceAccess.entityInstanceId)
      ),
      or(...granteeConditions)
    ),
  })

  if (grants.length === 0) {
    return { hasAccess: false, permission: null, grantedVia: null, accessLevel: null }
  }

  // 5. Find highest permission level (instance-specific grants take precedence)
  let highestPermission: ResourcePermission = grants[0]!.permission as ResourcePermission
  let grantedVia: 'direct' | 'group' | 'team' | 'role' = 'direct'
  let accessLevel: 'type' | 'instance' = grants[0]!.entityInstanceId ? 'instance' : 'type'

  for (const grant of grants) {
    const perm = grant.permission as ResourcePermission
    const isInstanceLevel = !!grant.entityInstanceId

    // Instance-level grants have priority, then compare permission level
    if (isInstanceLevel && accessLevel === 'type') {
      highestPermission = perm
      accessLevel = 'instance'
    } else if (isInstanceLevel === (accessLevel === 'instance')) {
      if (satisfiesPermission(perm, highestPermission)) {
        highestPermission = perm
      }
    }

    // Track how access was granted
    if (grant.granteeType === ResourceGranteeType.user) {
      grantedVia = 'direct'
    } else if (grant.granteeType === ResourceGranteeType.group) {
      grantedVia = 'group'
    } else if (grant.granteeType === ResourceGranteeType.team) {
      grantedVia = 'team'
    } else if (grant.granteeType === ResourceGranteeType.role) {
      grantedVia = 'role'
    }
  }

  return {
    hasAccess: true,
    permission: highestPermission,
    grantedVia,
    accessLevel,
  }
}

/**
 * Check if user has type-level access (access to ALL instances of an entity type).
 */
export async function checkTypeAccess(
  ctx: ResourceAccessContext,
  input: CheckTypeAccessInput
): Promise<AccessCheckResult> {
  const { db, organizationId } = ctx
  const { entityDefinitionId } = input
  const targetUserId = input.userId

  // Check for org admin
  const member = await db.query.OrganizationMember.findFirst({
    where: and(
      eq(schema.OrganizationMember.userId, targetUserId),
      eq(schema.OrganizationMember.organizationId, organizationId)
    ),
    columns: { role: true },
  })

  if (member && ['OWNER', 'ADMIN'].includes(member.role)) {
    return {
      hasAccess: true,
      permission: ResourcePermission.admin,
      grantedVia: 'role',
      accessLevel: 'type',
    }
  }

  // Get user's groups
  const userGroups = await db.query.EntityGroupMember.findMany({
    where: and(
      eq(schema.EntityGroupMember.memberType, MemberType.user),
      eq(schema.EntityGroupMember.memberRefId, targetUserId)
    ),
    columns: { groupInstanceId: true },
  })
  const groupIds = userGroups.map((g: { groupInstanceId: string }) => g.groupInstanceId)

  // Build grantee conditions
  const granteeConditions = [
    and(
      eq(schema.ResourceAccess.granteeType, ResourceGranteeType.user),
      eq(schema.ResourceAccess.granteeId, targetUserId)
    ),
    and(
      eq(schema.ResourceAccess.granteeType, ResourceGranteeType.role),
      eq(schema.ResourceAccess.granteeId, 'org_member')
    ),
  ]

  if (groupIds.length > 0) {
    granteeConditions.push(
      and(
        eq(schema.ResourceAccess.granteeType, ResourceGranteeType.group),
        inArray(schema.ResourceAccess.granteeId, groupIds)
      )
    )
  }

  // Find type-level grants only (entityInstanceId is null)
  const grants = await db.query.ResourceAccess.findMany({
    where: and(
      eq(schema.ResourceAccess.organizationId, organizationId),
      eq(schema.ResourceAccess.entityDefinitionId, entityDefinitionId),
      isNull(schema.ResourceAccess.entityInstanceId),
      or(...granteeConditions)
    ),
  })

  if (grants.length === 0) {
    return { hasAccess: false, permission: null, grantedVia: null, accessLevel: null }
  }

  // Find highest permission
  let highestPermission: ResourcePermission = grants[0]!.permission as ResourcePermission
  let grantedVia: 'direct' | 'group' | 'team' | 'role' = 'direct'

  for (const grant of grants) {
    const perm = grant.permission as ResourcePermission
    if (satisfiesPermission(perm, highestPermission)) {
      highestPermission = perm
      if (grant.granteeType === ResourceGranteeType.user) grantedVia = 'direct'
      else if (grant.granteeType === ResourceGranteeType.group) grantedVia = 'group'
      else if (grant.granteeType === ResourceGranteeType.team) grantedVia = 'team'
      else if (grant.granteeType === ResourceGranteeType.role) grantedVia = 'role'
    }
  }

  return {
    hasAccess: true,
    permission: highestPermission,
    grantedVia,
    accessLevel: 'type',
  }
}

/**
 * Check if user has at least the required permission level for a specific instance.
 */
export async function hasPermission(
  ctx: ResourceAccessContext,
  recordId: RecordId,
  required: ResourcePermission
): Promise<boolean> {
  const result = await checkAccess(ctx, {
    recordId,
    userId: ctx.userId,
  })

  if (!result.hasAccess || !result.permission) return false
  return satisfiesPermission(result.permission, required)
}

/**
 * Get all access grants for a specific instance.
 */
export async function getInstanceAccess(
  ctx: ResourceAccessContext,
  recordId: RecordId
): Promise<ResourceAccessInfo[]> {
  const { db, organizationId } = ctx
  const { entityDefinitionId, entityInstanceId } = parseRecordId(recordId)

  const grants = await db.query.ResourceAccess.findMany({
    where: and(
      eq(schema.ResourceAccess.organizationId, organizationId),
      eq(schema.ResourceAccess.entityDefinitionId, entityDefinitionId),
      eq(schema.ResourceAccess.entityInstanceId, entityInstanceId)
    ),
    orderBy: desc(schema.ResourceAccess.createdAt),
  })

  return grants.map((g: any) => ({
    id: g.id,
    entityDefinitionId: g.entityDefinitionId,
    entityInstanceId: g.entityInstanceId,
    granteeType: g.granteeType as ResourceGranteeType,
    granteeId: g.granteeId,
    permission: g.permission as ResourcePermission,
    createdAt: g.createdAt,
  }))
}

/**
 * Get all type-level access grants for an entity type.
 */
export async function getTypeAccess(
  ctx: ResourceAccessContext,
  entityDefinitionId: string
): Promise<ResourceAccessInfo[]> {
  const { db, organizationId } = ctx

  const grants = await db.query.ResourceAccess.findMany({
    where: and(
      eq(schema.ResourceAccess.organizationId, organizationId),
      eq(schema.ResourceAccess.entityDefinitionId, entityDefinitionId),
      isNull(schema.ResourceAccess.entityInstanceId)
    ),
    orderBy: desc(schema.ResourceAccess.createdAt),
  })

  return grants.map((g: any) => ({
    id: g.id,
    entityDefinitionId: g.entityDefinitionId,
    entityInstanceId: g.entityInstanceId,
    granteeType: g.granteeType as ResourceGranteeType,
    granteeId: g.granteeId,
    permission: g.permission as ResourcePermission,
    createdAt: g.createdAt,
  }))
}

/**
 * Get all entity instances accessible by a user (including via groups).
 * Returns both type-level grants (hasTypeAccess=true) and instance-specific grants.
 */
export async function getUserAccessibleInstances(
  ctx: ResourceAccessContext,
  userId: string,
  entityDefinitionId: string
): Promise<{
  hasTypeAccess: boolean
  typePermission: ResourcePermission | null
  instances: InstanceAccess[]
}> {
  const { db, organizationId } = ctx

  // Get user's groups
  const userGroups = await db.query.EntityGroupMember.findMany({
    where: and(
      eq(schema.EntityGroupMember.memberType, MemberType.user),
      eq(schema.EntityGroupMember.memberRefId, userId)
    ),
    columns: { groupInstanceId: true },
  })
  const groupIds = userGroups.map((g: { groupInstanceId: string }) => g.groupInstanceId)

  // Build grantee conditions
  const granteeConditions = [
    and(
      eq(schema.ResourceAccess.granteeType, ResourceGranteeType.user),
      eq(schema.ResourceAccess.granteeId, userId)
    ),
    and(
      eq(schema.ResourceAccess.granteeType, ResourceGranteeType.role),
      eq(schema.ResourceAccess.granteeId, 'org_member')
    ),
  ]

  if (groupIds.length > 0) {
    granteeConditions.push(
      and(
        eq(schema.ResourceAccess.granteeType, ResourceGranteeType.group),
        inArray(schema.ResourceAccess.granteeId, groupIds)
      )
    )
  }

  const grants = await db.query.ResourceAccess.findMany({
    where: and(
      eq(schema.ResourceAccess.organizationId, organizationId),
      eq(schema.ResourceAccess.entityDefinitionId, entityDefinitionId),
      or(...granteeConditions)
    ),
  })

  // Separate type-level and instance-level grants
  let hasTypeAccess = false
  let typePermission: ResourcePermission | null = null
  const instanceMap = new Map<string, ResourcePermission>()

  for (const grant of grants) {
    if (!grant.entityInstanceId) {
      // Type-level grant
      hasTypeAccess = true
      const perm = grant.permission as ResourcePermission
      if (!typePermission || satisfiesPermission(perm, typePermission)) {
        typePermission = perm
      }
    } else {
      // Instance-level grant
      const existing = instanceMap.get(grant.entityInstanceId)
      const current = grant.permission as ResourcePermission
      if (!existing || satisfiesPermission(current, existing)) {
        instanceMap.set(grant.entityInstanceId, current)
      }
    }
  }

  return {
    hasTypeAccess,
    typePermission,
    instances: Array.from(instanceMap.entries()).map(([instanceId, permission]) => ({
      recordId: toRecordId(entityDefinitionId, instanceId),
      permission,
    })),
  }
}
