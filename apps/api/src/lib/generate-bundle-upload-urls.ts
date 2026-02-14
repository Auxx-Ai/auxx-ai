// apps/api/src/services/app-version-bundles/generate-bundle-upload-urls.ts

import { database, schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import type { AppVersionBundleError } from './errors'
import { generatePresignedUploadUrl } from './s3'
import { fromDatabase } from './utils'

/**
 * Upload URLs data returned from generation
 */
interface GenerateUrlsSuccess {
  urls: {
    clientBundleUploadUrl: string
    serverBundleUploadUrl: string
  }
}

/**
 * Generate S3 upload URLs for a bundle and update the bundle record
 *
 * @param params - Object containing bundleId, appId, and versionId
 * @returns Result with upload URLs or an error
 */
export async function generateBundleUploadUrls(params: {
  bundleId: string
  appId: string
  versionId: string
}): Promise<Result<GenerateUrlsSuccess, AppVersionBundleError>> {
  const { bundleId, appId, versionId } = params

  // Generate S3 keys using bundle ID
  const clientBundleKey = `apps/${appId}/versions/${versionId}/bundles/${bundleId}/client.js`
  const serverBundleKey = `apps/${appId}/versions/${versionId}/bundles/${bundleId}/server.js`

  // Generate presigned URLs (24 hour expiry) in parallel
  const [clientUrlResult, serverUrlResult] = await Promise.all([
    generatePresignedUploadUrl(clientBundleKey, 24 * 60 * 60),
    generatePresignedUploadUrl(serverBundleKey, 24 * 60 * 60),
  ])

  // Check for S3 errors
  if (clientUrlResult.isErr()) {
    return err(clientUrlResult.error)
  }
  if (serverUrlResult.isErr()) {
    return err(serverUrlResult.error)
  }

  const clientUploadUrl = clientUrlResult.value
  const serverUploadUrl = serverUrlResult.value

  // Update bundle with S3 info
  const dbResult = await fromDatabase(
    database
      .update(schema.AppVersionBundle)
      .set({
        clientBundleS3Key: clientBundleKey,
        serverBundleS3Key: serverBundleKey,
        clientBundleUploadUrl: clientUploadUrl,
        serverBundleUploadUrl: serverUploadUrl,
        updatedAt: new Date(),
      })
      .where(eq(schema.AppVersionBundle.id, bundleId)),
    'update-bundle-urls'
  )

  // Check for database errors
  if (dbResult.isErr()) {
    return err(dbResult.error)
  }

  // Success
  return ok({
    urls: {
      clientBundleUploadUrl: clientUploadUrl,
      serverBundleUploadUrl: serverUploadUrl,
    },
  })
}
