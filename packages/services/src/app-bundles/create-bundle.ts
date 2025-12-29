// apps/api/src/services/app-version-bundles/create-bundle.ts

import { database, schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { ok, err } from 'neverthrow'
// import type { AppBundleError } from './errors'
import { fromDatabase } from '../shared/utils'

/**
 * Create a new bundle for a version.
 * For dev versions, supersedes any incomplete bundles first.
 *
 * @param params - Object containing appVersionId and versionType
 * @returns Result with bundle data or an error
 */
export async function createBundle(params: { appVersionId: string; versionType: 'dev' | 'prod' }) {
  const { appVersionId, versionType } = params

  // For dev versions, supersede incomplete bundles first
  if (versionType === 'dev') {
    const supersedeResult = await fromDatabase(
      database
        .update(schema.AppVersionBundle)
        .set({
          // Mark as not the latest (could add supersededAt field)
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.AppVersionBundle.appVersionId, appVersionId),
            eq(schema.AppVersionBundle.isComplete, false)
          )
        ),
      'supersede-incomplete-bundles'
    )

    // Continue even if supersede fails (not critical)
    if (supersedeResult.isErr()) {
      console.warn('Failed to supersede incomplete bundles:', supersedeResult.error)
    }
  }

  // Insert bundle with error handling
  const dbResult = await fromDatabase(
    database
      .insert(schema.AppVersionBundle)
      .values({
        appVersionId,
        versionType,
        updatedAt: new Date(),
      })
      .returning(),
    'create-bundle'
  )

  // Check for database errors
  if (dbResult.isErr()) {
    return err(dbResult.error)
  }

  const [bundle] = dbResult.value

  // Bundle creation failed
  if (!bundle) {
    return err({
      code: 'CREATE_FAILED' as const,
      message: `Failed to create bundle for version ${appVersionId}`,
      cause: 'No bundle returned from insert',
    })
  }

  // Success
  return ok(bundle)
}
