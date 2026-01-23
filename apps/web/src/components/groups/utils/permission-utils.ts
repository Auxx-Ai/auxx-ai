// apps/web/src/components/groups/utils/permission-utils.ts

import { ResourcePermission, satisfiesPermission } from '@auxx/lib/groups/client'

/**
 * Check if user can view a group
 */
export function canViewGroup(permission: ResourcePermission | null | undefined): boolean {
  if (!permission) return false
  return satisfiesPermission(permission, ResourcePermission.view)
}

/**
 * Check if user can edit a group (name, description, settings, add/remove members)
 */
export function canEditGroup(permission: ResourcePermission | null | undefined): boolean {
  if (!permission) return false
  return satisfiesPermission(permission, ResourcePermission.edit)
}

/**
 * Check if user can manage group members (add/remove)
 * Note: This is now combined with edit permission in ResourceAccess
 */
export function canManageMembers(permission: ResourcePermission | null | undefined): boolean {
  if (!permission) return false
  return satisfiesPermission(permission, ResourcePermission.edit)
}

/**
 * Check if user has admin permission on a group (full control)
 */
export function canAdminGroup(permission: ResourcePermission | null | undefined): boolean {
  if (!permission) return false
  return satisfiesPermission(permission, ResourcePermission.admin)
}
