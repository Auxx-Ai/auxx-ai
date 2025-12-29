// apps/api/src/services/app-version-bundles/complete-bundle.ts

import { database, schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { ok, err } from 'neverthrow'
// import type { AppBundleError } from './errors'
import { fromDatabase } from '../shared/utils'

/**
 * Mark a bundle as complete after upload
 *
 * @param params - Object containing bundleId, optional SHA value, optional settings schema, and optional versionId
 * @returns Result indicating success or an error
 */
export async function completeBundle(params: {
  bundleId: string
  bundleSha?: string
  settingsSchema?: { organization?: Record<string, unknown>; user?: Record<string, unknown> }
  versionId?: string
}) {
  const { bundleId, bundleSha, settingsSchema, versionId } = params

  // Prepare update data
  const updateData: any = {
    clientBundleUploaded: true,
    serverBundleUploaded: true,
    isComplete: true,
    completedAt: new Date(),
    updatedAt: new Date(),
  }

  // Add SHA if provided
  if (bundleSha) {
    updateData.bundleSha = bundleSha
  }

  // Update bundle with error handling
  const dbResult = await fromDatabase(
    database
      .update(schema.AppVersionBundle)
      .set(updateData)
      .where(eq(schema.AppVersionBundle.id, bundleId)),
    'complete-bundle'
  )

  // Check for database errors
  if (dbResult.isErr()) {
    return err(dbResult.error)
  }

  // Store settings schema in AppVersion if provided
  if (settingsSchema && versionId) {
    const schemaResult = await fromDatabase(
      database
        .update(schema.AppVersion)
        .set({
          settingsSchema,
          updatedAt: new Date(),
        })
        .where(eq(schema.AppVersion.id, versionId)),
      'store-settings-schema'
    )

    if (schemaResult.isErr()) {
      // Log error but don't fail the request - bundle is still marked complete
      console.error('[CompleteBundle] Failed to store settings schema:', schemaResult.error)
      // Continue - bundle completion is more critical than schema storage
    }
  }

  // Success
  return ok(undefined)
}
