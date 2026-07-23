// packages/lib/src/resource-access/constants.ts

import { ResourcePermission } from '@auxx/database/enums'

/**
 * Permission hierarchy - higher index = more permissions.
 *
 * `ResourcePermission.none` is deliberately OMITTED: it is a baseline-only
 * marker (capability layer v2 phase 3) meaning "def is restricted, grants
 * nobody". Because {@link satisfiesPermission} does an `indexOf`, a `none`
 * actual resolves to `-1` and therefore never satisfies any required
 * permission — exactly the "grants nobody" semantic. Never add `none` here.
 */
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
