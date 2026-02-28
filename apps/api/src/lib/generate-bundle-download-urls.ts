// apps/api/src/services/app-version-bundles/generate-bundle-download-urls.ts

import { database } from '@auxx/database'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { err, ok, type Result } from 'neverthrow'
import type { AppVersionBundleError } from './errors'
import { getS3BucketName, getS3Client } from './s3'
import { fromDatabase, fromS3 } from './utils'

/**
 * Download URLs data returned from generation
 */
interface GenerateDownloadUrlsSuccess {
  urls: {
    clientBundleDownloadUrl: string
    serverBundleDownloadUrl: string
  }
  bundleId: string
  s3Keys: {
    clientBundleS3Key: string
    serverBundleS3Key: string
  }
}

/**
 * Generate S3 download URLs for a bundle
 * Used at runtime to fetch bundles for execution
 *
 * @param params - Object containing bundleId
 * @returns Result with download URLs or an error
 */
export async function generateBundleDownloadUrls(params: {
  bundleId: string
}): Promise<Result<GenerateDownloadUrlsSuccess, AppVersionBundleError>> {
  const { bundleId } = params

  // Get bundle with S3 keys
  const dbResult = await fromDatabase(
    database.query.AppVersionBundle.findFirst({
      where: (bundles, { eq }) => eq(bundles.id, bundleId),
    }),
    'get-bundle-for-download'
  )

  if (dbResult.isErr()) {
    return err(dbResult.error)
  }

  const bundle = dbResult.value

  if (!bundle) {
    return err({
      code: 'BUNDLE_NOT_FOUND' as const,
      message: `Bundle not found: ${bundleId}`,
      bundleId,
    })
  }

  if (!bundle.clientBundleS3Key || !bundle.serverBundleS3Key) {
    return err({
      code: 'BUNDLE_NOT_COMPLETE' as const,
      message: `Bundle ${bundleId} does not have S3 keys`,
      bundleId,
    })
  }

  // Generate presigned download URLs (1 hour expiry)
  const DOWNLOAD_URL_EXPIRY = 60 * 60 // 1 hour

  const clientCommand = new GetObjectCommand({
    Bucket: getS3BucketName(),
    Key: bundle.clientBundleS3Key,
  })

  const serverCommand = new GetObjectCommand({
    Bucket: getS3BucketName(),
    Key: bundle.serverBundleS3Key,
  })

  const [clientUrlResult, serverUrlResult] = await Promise.all([
    fromS3(
      getSignedUrl(getS3Client(), clientCommand, { expiresIn: DOWNLOAD_URL_EXPIRY }),
      'generate-download-url'
    ),
    fromS3(
      getSignedUrl(getS3Client(), serverCommand, { expiresIn: DOWNLOAD_URL_EXPIRY }),
      'generate-download-url'
    ),
  ])

  if (clientUrlResult.isErr()) {
    return err(clientUrlResult.error)
  }
  if (serverUrlResult.isErr()) {
    return err(serverUrlResult.error)
  }

  return ok({
    urls: {
      clientBundleDownloadUrl: clientUrlResult.value,
      serverBundleDownloadUrl: serverUrlResult.value,
    },
    bundleId,
    s3Keys: {
      clientBundleS3Key: bundle.clientBundleS3Key,
      serverBundleS3Key: bundle.serverBundleS3Key,
    },
  })
}
