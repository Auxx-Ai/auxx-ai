// apps/web/src/server/api/routers/setting-write-permission.ts

import { PermissionKey } from '@auxx/lib/permissions/client'

/** The capability an org-setting write needs: `mrp.manage` when every key is `mrp.*`, else `settingsManage`. */
export function settingWritePermission(keys: readonly string[]): PermissionKey {
  return keys.length > 0 && keys.every((key) => key.startsWith('mrp.'))
    ? PermissionKey.mrpManage
    : PermissionKey.settingsManage
}
