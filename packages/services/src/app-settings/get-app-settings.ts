// packages/services/src/app-settings/get-app-settings.ts

import { database } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { ok, err } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import { mergeSettingsWithDefaults, type FormSchema } from './merge-with-defaults'

/**
 * Get all settings for an app installation, merged with schema defaults
 */
export async function getAppSettings(params: {
  appInstallationId: string
  schema?: FormSchema // Current version's schema
}) {
  const { appInstallationId, schema } = params

  // Fetch saved settings from DB
  const dbResult = await fromDatabase(
    database.query.AppSetting.findMany({
      where: (settings, { eq }) => eq(settings.appInstallationId, appInstallationId),
    }),
    'get-app-settings'
  )

  if (dbResult.isErr()) {
    return err(dbResult.error)
  }

  const settings = dbResult.value

  // Convert array to object
  const savedSettings: Record<string, any> = {}
  for (const setting of settings) {
    savedSettings[setting.key] = setting.value
  }

  // If schema provided, merge with defaults
  if (schema) {
    const merged = mergeSettingsWithDefaults(savedSettings, schema)
    return ok(merged)
  }

  // Otherwise return raw saved values
  return ok(savedSettings)
}
