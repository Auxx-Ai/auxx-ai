// packages/lib/src/cache/providers/user-settings-provider.ts

import { SettingsService } from '../../settings'
import type { SettingValue } from '../../settings/types'
import type { CacheProvider } from '../org-cache-provider'

/** Computes user settings for a specific org. Receives "userId:orgId" as the compute ID. */
export const userSettingsProvider: CacheProvider<Record<string, SettingValue>> = {
  async compute(compositeId, db) {
    const [userId, organizationId] = compositeId.split(':')
    if (!userId || !organizationId) {
      throw new Error(`Invalid composite ID for userSettings: ${compositeId}`)
    }

    const settingsService = new SettingsService(db)
    return settingsService.getAllUserSettings({ userId, organizationId })
  },
}
