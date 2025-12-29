// packages/services/src/app-settings/set-app-setting.ts

import { saveAppSettings } from './save-app-settings'

/**
 * Set a single setting value
 */
export async function setAppSetting(params: {
  appInstallationId: string
  appVersionId?: string
  key: string
  value: any
}) {
  return saveAppSettings({
    appInstallationId: params.appInstallationId,
    appVersionId: params.appVersionId,
    settings: { [params.key]: params.value },
  })
}
