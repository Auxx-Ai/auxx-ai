// packages/services/src/app-settings/set-app-setting.ts

import { saveAppSettings } from './save-app-settings'

/**
 * Set a single setting value
 */
export async function setAppSetting(params: {
  appInstallationId: string
  appDeploymentId?: string
  key: string
  value: any
}) {
  return saveAppSettings({
    appInstallationId: params.appInstallationId,
    appDeploymentId: params.appDeploymentId,
    settings: { [params.key]: params.value },
  })
}
