// packages/lib/src/groups/permission-functions.ts

import { type ResourceGranteeType, ResourcePermission } from '@auxx/database/enums'
import type { GrantPermissionInput, GroupContext, GroupPermissionInfo } from '@auxx/types/groups'
import { toRecordId } from '@auxx/types/resource'
import { getInstanceAccess, grantInstanceAccess, revokeInstanceAccess } from '../resource-access'
import { ResourceRegistryService } from '../resources/registry'
import { requireGroupPermission } from './permissions'

/**
 * Get the entity_group entityDefinitionId using efficient cached resolution
 */
async function getGroupEntityDefId(ctx: GroupContext): Promise<string> {
  const registry = new ResourceRegistryService(ctx.organizationId, ctx.db)
  return registry.resolveEntityDefId('entity_group')
}

/**
 * Grant a permission to a user, team, group, or role
 */
export async function grantPermission(
  ctx: GroupContext,
  input: GrantPermissionInput
): Promise<GroupPermissionInfo> {
  const { db, organizationId, userId } = ctx
  const { groupId, granteeType, granteeId, permission } = input

  // Require admin permission to grant permissions
  await requireGroupPermission(ctx, groupId, ResourcePermission.admin)

  // Get entity_group entityDefinitionId (cached for 30 days)
  const entityDefinitionId = await getGroupEntityDefId(ctx)

  // Grant via ResourceAccess
  await grantInstanceAccess(
    { db, organizationId, userId },
    {
      recordId: toRecordId(entityDefinitionId, groupId),
      granteeType,
      granteeId,
      permission,
    }
  )

  // Return the permission info (fetch from ResourceAccess)
  const grants = await getInstanceAccess(
    { db, organizationId, userId },
    toRecordId(entityDefinitionId, groupId)
  )

  const grant = grants.find((g) => g.granteeType === granteeType && g.granteeId === granteeId)

  if (!grant) {
    throw new Error('Failed to grant permission')
  }

  return {
    id: grant.id,
    granteeType: grant.granteeType,
    granteeId: grant.granteeId,
    permission: grant.permission,
    createdAt: grant.createdAt,
  }
}

/**
 * Revoke a permission from a user, team, group, or role
 */
export async function revokePermission(
  ctx: GroupContext,
  groupId: string,
  granteeType: ResourceGranteeType,
  granteeId: string
): Promise<boolean> {
  const { db, organizationId, userId } = ctx

  // Require admin permission to revoke permissions
  await requireGroupPermission(ctx, groupId, ResourcePermission.admin)

  // Get entity_group entityDefinitionId (cached for 30 days)
  const entityDefinitionId = await getGroupEntityDefId(ctx)

  // Revoke via ResourceAccess
  return revokeInstanceAccess(
    { db, organizationId, userId },
    {
      recordId: toRecordId(entityDefinitionId, groupId),
      granteeType,
      granteeId,
    }
  )
}

/**
 * Get all permissions for a group
 */
export async function getPermissions(
  ctx: GroupContext,
  groupId: string
): Promise<GroupPermissionInfo[]> {
  const { db, organizationId, userId } = ctx

  // Require view permission to see permissions
  await requireGroupPermission(ctx, groupId, ResourcePermission.view)

  // Get entity_group entityDefinitionId (cached for 30 days)
  const entityDefinitionId = await getGroupEntityDefId(ctx)

  // Get permissions via ResourceAccess
  const grants = await getInstanceAccess(
    { db, organizationId, userId },
    toRecordId(entityDefinitionId, groupId)
  )

  return grants.map((g) => ({
    id: g.id,
    granteeType: g.granteeType,
    granteeId: g.granteeId,
    permission: g.permission,
    createdAt: g.createdAt,
  }))
}
