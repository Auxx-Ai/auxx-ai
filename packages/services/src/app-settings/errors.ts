// packages/services/src/app-settings/errors.ts

/**
 * App setting not found error
 */
export type AppSettingNotFoundError = {
  code: 'APP_SETTING_NOT_FOUND'
  message: string
  appInstallationId: string
  key: string
}

/**
 * All possible app settings errors
 */
export type AppSettingsError = AppSettingNotFoundError
