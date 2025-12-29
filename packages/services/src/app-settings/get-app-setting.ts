// packages/services/src/app-settings/get-app-setting.ts

import { database } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'

/**
 * Get a single setting value
 */
export async function getAppSetting(params: { appInstallationId: string; key: string }) {
  const { appInstallationId, key } = params

  const dbResult = await fromDatabase(
    database.query.AppSetting.findFirst({
      where: (settings, { and, eq }) =>
        and(eq(settings.appInstallationId, appInstallationId), eq(settings.key, key)),
    }),
    'get-app-setting'
  )

  if (dbResult.isErr()) {
    return dbResult
  }

  const setting = dbResult.value

  return ok(setting?.value ?? null)
}
