// apps/web/src/server/api/routers/setting-write-permission.test.ts

import { PermissionKey } from '@auxx/lib/permissions/client'
import { describe, expect, it } from 'vitest'
import { settingWritePermission } from './setting-write-permission'

describe('settingWritePermission', () => {
  it('asks for mrp.manage when every key is an mrp.* key', () => {
    expect(settingWritePermission(['mrp.aduWindowDays', 'mrp.runRetentionDays'])).toBe(
      PermissionKey.mrpManage
    )
  })

  it('asks for settingsManage once any key is outside mrp.*', () => {
    expect(settingWritePermission(['mrp.aduWindowDays', 'inventory.autoBuildFromOrders'])).toBe(
      PermissionKey.settingsManage
    )
    expect(settingWritePermission(['inventory.autoBuildFromOrders'])).toBe(
      PermissionKey.settingsManage
    )
  })

  it('asks for settingsManage on an empty batch or a look-alike prefix', () => {
    expect(settingWritePermission([])).toBe(PermissionKey.settingsManage)
    expect(settingWritePermission(['mrpx.aduWindowDays'])).toBe(PermissionKey.settingsManage)
  })
})
