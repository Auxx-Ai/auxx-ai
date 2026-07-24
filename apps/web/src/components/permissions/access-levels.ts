// apps/web/src/components/permissions/access-levels.ts

import { ResourcePermission } from '@auxx/database/enums'
import { Level } from '@auxx/lib/permissions/client'

/**
 * Client-safe rank of a record permission (`none` < view < edit < admin). Used
 * by the def-access surfaces to decide whether a grant lifts anything above the
 * level it composes with ("ignored" / "no effect").
 */
export const PERMISSION_RANK: Record<ResourcePermission, number> = {
  [ResourcePermission.none]: 0,
  [ResourcePermission.view]: 1,
  [ResourcePermission.edit]: 2,
  [ResourcePermission.admin]: 3,
}

/**
 * A Layer-2 records rung → its Layer-3 record-permission equivalent. The bridge
 * between the two storage systems the permissions page stacks: a def with no
 * `role:org_member` row falls through to the Records area level, and this is the
 * value that fall-through resolves to (rendered as the picker's "Inherit · …").
 */
export const LEVEL_TO_PERMISSION: Record<Level, ResourcePermission> = {
  [Level.None]: ResourcePermission.none,
  [Level.Read]: ResourcePermission.view,
  [Level.Edit]: ResourcePermission.edit,
  [Level.Full]: ResourcePermission.admin,
}
