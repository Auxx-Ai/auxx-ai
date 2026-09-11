// packages/services/src/app-settings/get-app-settings.ts

import { database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { err, ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import {
  type FormSchema,
  mergeSettingsWithDefaults,
  type SettingsTypeMismatch,
} from './merge-with-defaults'

const logger = createScopedLogger('app-settings')

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
    // A mismatch means a stored value the CURRENT deployment's schema cannot
    // read, so the read substitutes a default. Saving then persists that default
    // over the original, and a switch back cannot recover it — the one way a
    // settings value is lost when an installation is repointed between
    // deployments. Too consequential to leave as a `console.warn` nobody reads:
    // logged at warn with the installation, so it is searchable in OpenObserve.
    const mismatches: SettingsTypeMismatch[] = []
    const merged = mergeSettingsWithDefaults(savedSettings, schema, (m) => mismatches.push(m))

    if (mismatches.length > 0) {
      logger.warn('Stored app settings are unreadable under the current schema', {
        appInstallationId,
        mismatches,
      })
    }

    return ok(merged)
  }

  // Otherwise return raw saved values
  return ok(savedSettings)
}
