// packages/lib/src/groups/permissions.ts

import { ResourcePermission } from '@auxx/database/enums'
import type { GroupContext } from '@auxx/types/groups'
import { toRecordId } from '@auxx/types/resource'
import { getOrgCache } from '../cache'
import { ForbiddenError } from '../errors'
import { checkAccess, hasPermission as resourceHasPermission } from '../resource-access'

/**
 * Get the entity_group entityDefinitionId using cached entity defs
 */
async function getGroupEntityDefId(ctx: GroupContext): Promise<string> {
  const { entityDefs } = await getOrgCache().getOrRecompute(ctx.organizationId, ['entityDefs'])
  const defId = entityDefs.entity_group
  if (!defId)
    throw new Error(`entity_group EntityDefinition not found for org ${ctx.organizationId}`)
  return defId
}

/**
 * Get user's permission level on a group
 * Checks org role first (owners/admins get admin), then ResourceAccess
 */
export async function getGroupPermission(
  ctx: GroupContext,
  groupId: string
): Promise<ResourcePermission | null> {
  const { db, userId, organizationId } = ctx

  // Check org role from cache (no DB query)
  const { memberRoleMap } = await getOrgCache().getOrRecompute(organizationId, ['memberRoleMap'])
  const role = memberRoleMap[userId]

  if (role === 'OWNER' || role === 'ADMIN') {
    return ResourcePermission.admin
  }

  // Get entity_group entityDefinitionId (cached)
  const entityDefinitionId = await getGroupEntityDefId(ctx)

  // Check ResourceAccess
  const result = await checkAccess(
    { db, organizationId, userId },
    {
      recordId: toRecordId(entityDefinitionId, groupId),
      userId,
    }
  )

  return result.permission
}

/**
 * Check if user has at least the required permission level
 */
export async function hasGroupPermission(
  ctx: GroupContext,
  groupId: string,
  required: ResourcePermission
): Promise<boolean> {
  const { db, organizationId, userId } = ctx

  // Check org role from cache (no DB query)
  const { memberRoleMap } = await getOrgCache().getOrRecompute(organizationId, ['memberRoleMap'])
  const role = memberRoleMap[userId]

  if (role === 'OWNER' || role === 'ADMIN') {
    return true // Admin satisfies any permission
  }

  // Get entity_group entityDefinitionId (cached)
  const entityDefinitionId = await getGroupEntityDefId(ctx)

  // Use ResourceAccess hasPermission
  return resourceHasPermission(
    { db, organizationId, userId },
    toRecordId(entityDefinitionId, groupId),
    required
  )
}

/**
 * Assert user has permission, throw ForbiddenError if not
 */
export async function requireGroupPermission(
  ctx: GroupContext,
  groupId: string,
  required: ResourcePermission
): Promise<void> {
  const hasIt = await hasGroupPermission(ctx, groupId, required)
  if (!hasIt) {
    throw new ForbiddenError(`Missing '${required}' permission on group`)
  }
}
