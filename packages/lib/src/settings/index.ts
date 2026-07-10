// packages/lib/src/settings/index.ts
//
// Org/user settings (v2): code-declared catalog + functional service module.
// See plans/settings/v2/README.md. The legacy `UserSettingsService`
// (`User.settings` jsonb blob) is deleted — this is now the one settings
// system.

export { isSettingKey, SETTINGS_CATALOG, type SettingConfig, type SettingKey } from './catalog'
export { normalizeSettingValue } from './normalize-setting-value'
export {
  batchUpdateOrganizationSettings,
  getAllOrganizationSettings,
  getAllUserSettings,
  getOrganizationSetting,
  getOrganizationSettingsWithMetadata,
  getUserSetting,
  type OrganizationSettingWithMetadata,
  resetUserSetting,
  updateOrganizationSetting,
  updateUserSetting,
} from './settings-service'
export type { SettingScope, SettingValue } from './types'
