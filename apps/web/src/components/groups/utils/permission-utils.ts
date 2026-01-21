// apps/web/src/components/groups/utils/permission-utils.ts

import { PermissionLevel, satisfiesPermission } from '@auxx/lib/groups/client'

/**
 * Check if user can view a group
 */
export function canViewGroup(permission: PermissionLevel | null | undefined): boolean {
  if (!permission) return false
  return satisfiesPermission(permission, PermissionLevel.view)
}

/**
 * Check if user can edit a group (name, description, settings)
 */
export function canEditGroup(permission: PermissionLevel | null | undefined): boolean {
  if (!permission) return false
  return satisfiesPermission(permission, PermissionLevel.edit)
}

/**
 * Check if user can manage group members (add/remove)
 */
export function canManageMembers(permission: PermissionLevel | null | undefined): boolean {
  if (!permission) return false
  return satisfiesPermission(permission, PermissionLevel.manage_members)
}

/**
 * Check if user has admin permission on a group (full control)
 */
export function canAdminGroup(permission: PermissionLevel | null | undefined): boolean {
  if (!permission) return false
  return satisfiesPermission(permission, PermissionLevel.admin)
}
