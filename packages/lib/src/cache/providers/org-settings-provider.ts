// packages/lib/src/cache/providers/org-settings-provider.ts

import { SettingsService } from '../../settings'
import type { SettingValue } from '../../settings/types'
import type { CacheProvider } from '../org-cache-provider'

export const orgSettingsProvider: CacheProvider<Record<string, SettingValue>> = {
  async compute(orgId, db) {
    const settingsService = new SettingsService(db)
    return settingsService.getAllOrganizationSettings({ organizationId: orgId })
  },
}
