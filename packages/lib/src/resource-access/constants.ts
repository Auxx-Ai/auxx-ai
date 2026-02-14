// packages/lib/src/resource-access/constants.ts

import { ResourcePermission } from '@auxx/database/enums'

/** Permission hierarchy - higher index = more permissions */
export const PERMISSION_HIERARCHY: ResourcePermission[] = [
  ResourcePermission.view,
  ResourcePermission.edit,
  ResourcePermission.admin,
]

/**
 * Check if actual permission satisfies required permission
 */
export function satisfiesPermission(
  actual: ResourcePermission,
  required: ResourcePermission
): boolean {
  const actualIndex = PERMISSION_HIERARCHY.indexOf(actual)
  const requiredIndex = PERMISSION_HIERARCHY.indexOf(required)
  return actualIndex >= requiredIndex
}
