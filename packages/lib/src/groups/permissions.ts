// packages/lib/src/groups/permissions.ts

import { and, eq } from 'drizzle-orm'
import { schema } from '@auxx/database'
import { ResourcePermission } from '@auxx/database/enums'
import { checkAccess, hasPermission as resourceHasPermission } from '../resource-access'
import { ResourceRegistryService } from '../resources/registry'
import { toRecordId } from '@auxx/types/resource'
import type { GroupContext } from '@auxx/types/groups'
import { ForbiddenError } from '../errors'

/**
 * Get the entity_group entityDefinitionId using efficient cached resolution
 */
async function getGroupEntityDefId(ctx: GroupContext): Promise<string> {
  const registry = new ResourceRegistryService(ctx.organizationId, ctx.db)
  return registry.resolveEntityDefId('entity_group')
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

  // Check org role first (owners/admins get admin)
  const member = await db.query.OrganizationMember.findFirst({
    where: and(
      eq(schema.OrganizationMember.userId, userId),
      eq(schema.OrganizationMember.organizationId, organizationId)
    ),
    columns: { role: true },
  })

  if (member && ['OWNER', 'ADMIN'].includes(member.role)) {
    return ResourcePermission.admin
  }

  // Get entity_group entityDefinitionId (cached for 30 days)
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

  // Check org role first (owners/admins have admin)
  const member = await db.query.OrganizationMember.findFirst({
    where: and(
      eq(schema.OrganizationMember.userId, userId),
      eq(schema.OrganizationMember.organizationId, organizationId)
    ),
    columns: { role: true },
  })

  if (member && ['OWNER', 'ADMIN'].includes(member.role)) {
    return true // Admin satisfies any permission
  }

  // Get entity_group entityDefinitionId (cached for 30 days)
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
