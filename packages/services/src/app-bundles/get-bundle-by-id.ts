// apps/api/src/services/app-version-bundles/get-bundle-by-id.ts

import { database } from '@auxx/database'
import { err, ok, type Result } from 'neverthrow'
// import type { AppBundleError } from './errors'
import { fromDatabase } from '../shared/utils'

/**
 * Get bundle by ID
 *
 * @param params - Object containing bundleId
 * @returns Result with bundle data or an error
 */
export async function getBundleById(params: { bundleId: string }) {
  const { bundleId } = params

  // Query database with error handling
  const dbResult = await fromDatabase(
    database.query.AppVersionBundle.findFirst({
      where: (bundles, { eq }) => eq(bundles.id, bundleId),
    }),
    'get-bundle-by-id'
  )

  // Check for database errors
  if (dbResult.isErr()) {
    return err(dbResult.error)
  }

  const bundle = dbResult.value

  // Bundle not found
  if (!bundle) {
    return err({
      code: 'BUNDLE_NOT_FOUND' as const,
      message: `Bundle not found: ${bundleId}`,
      bundleId,
    })
  }

  // Success
  return ok(bundle)
}
