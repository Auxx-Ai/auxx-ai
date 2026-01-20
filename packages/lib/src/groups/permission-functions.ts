// packages/lib/src/groups/permission-functions.ts

import { and, eq } from 'drizzle-orm'
import { schema } from '@auxx/database'
import { PermissionLevel, GranteeType } from '@auxx/database/enums'
import type { GroupContext, GrantPermissionInput, GroupPermissionInfo } from '@auxx/types/groups'
import { requireGroupPermission } from './permissions'

/**
 * Grant a permission to a user, team, or role
 */
export async function grantPermission(
  ctx: GroupContext,
  input: GrantPermissionInput
): Promise<GroupPermissionInfo> {
  const { db, userId } = ctx
  const { groupId, granteeType, granteeId, permission } = input

  // Require admin permission to grant permissions
  await requireGroupPermission(ctx, groupId, PermissionLevel.admin)

  // Upsert permission (update if exists, insert if not)
  const [result] = await db
    .insert(schema.EntityGroupPermission)
    .values({
      groupInstanceId: groupId,
      granteeType: granteeType as GranteeType,
      granteeId,
      permission,
      grantedById: userId,
    })
    .onConflictDoUpdate({
      target: [
        schema.EntityGroupPermission.groupInstanceId,
        schema.EntityGroupPermission.granteeType,
        schema.EntityGroupPermission.granteeId,
      ],
      set: {
        permission,
        grantedById: userId,
        updatedAt: new Date(),
      },
    })
    .returning()

  if (!result) {
    throw new Error('Failed to grant permission')
  }

  return {
    id: result.id,
    granteeType: result.granteeType as 'user' | 'team' | 'role',
    granteeId: result.granteeId,
    permission: result.permission as PermissionLevel,
    createdAt: result.createdAt,
  }
}

/**
 * Revoke a permission from a user, team, or role
 */
export async function revokePermission(
  ctx: GroupContext,
  groupId: string,
  granteeType: 'user' | 'team' | 'role',
  granteeId: string
): Promise<boolean> {
  const { db } = ctx

  // Require admin permission to revoke permissions
  await requireGroupPermission(ctx, groupId, PermissionLevel.admin)

  const result = await db
    .delete(schema.EntityGroupPermission)
    .where(
      and(
        eq(schema.EntityGroupPermission.groupInstanceId, groupId),
        eq(schema.EntityGroupPermission.granteeType, granteeType as GranteeType),
        eq(schema.EntityGroupPermission.granteeId, granteeId)
      )
    )
    .returning()

  return result.length > 0
}

/**
 * Get all permissions for a group
 */
export async function getPermissions(ctx: GroupContext, groupId: string): Promise<GroupPermissionInfo[]> {
  const { db } = ctx

  // Require view permission to see permissions
  await requireGroupPermission(ctx, groupId, PermissionLevel.view)

  const permissions = await db.query.EntityGroupPermission.findMany({
    where: eq(schema.EntityGroupPermission.groupInstanceId, groupId),
  })

  return permissions.map((p) => ({
    id: p.id,
    granteeType: p.granteeType as 'user' | 'team' | 'role',
    granteeId: p.granteeId,
    permission: p.permission as PermissionLevel,
    createdAt: p.createdAt,
  }))
}
