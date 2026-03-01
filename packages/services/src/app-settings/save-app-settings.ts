// packages/services/src/app-settings/save-app-settings.ts

import { AppSetting, database } from '@auxx/database'
import { ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'

/**
 * Save multiple settings (upsert)
 */
export async function saveAppSettings(params: {
  appInstallationId: string
  appDeploymentId?: string
  settings: Record<string, any>
}) {
  const { appInstallationId, appDeploymentId, settings } = params

  // Upsert each setting (filter out undefined values)
  const promises = Object.entries(settings)
    .filter(([_, value]) => value !== undefined)
    .map(([key, value]) =>
      fromDatabase(
        database
          .insert(AppSetting)
          .values({
            appInstallationId,
            appDeploymentId: appDeploymentId ?? null,
            key,
            value,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [AppSetting.appInstallationId, AppSetting.key],
            set: {
              value,
              appDeploymentId: appDeploymentId ?? null,
              updatedAt: new Date(),
            },
          }),
        'save-app-settings'
      )
    )

  const results = await Promise.all(promises)

  // Check if any failed
  for (const result of results) {
    if (result.isErr()) {
      return result
    }
  }

  return ok(undefined)
}
