// apps/lambda/src/bundle-loader.ts

/**
 * Bundle loader - supports both S3 (production) and filesystem (development)
 */

import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { parseError } from './utils.ts'

/** Custom S3 endpoint for non-AWS providers */
const s3Endpoint = Deno.env.get('S3_ENDPOINT')
const forcePathStyle = Deno.env.get('S3_FORCE_PATH_STYLE') !== 'false'

/** S3 client instance (reused across invocations) */
const s3Client = new S3Client({
  region: Deno.env.get('S3_REGION') || 'us-west-1',
  ...(s3Endpoint ? { endpoint: s3Endpoint, forcePathStyle } : {}),
  credentials:
    Deno.env.get('S3_ACCESS_KEY_ID') && Deno.env.get('S3_SECRET_ACCESS_KEY')
      ? {
          accessKeyId: Deno.env.get('S3_ACCESS_KEY_ID')!,
          secretAccessKey: Deno.env.get('S3_SECRET_ACCESS_KEY')!,
        }
      : undefined, // Falls back to environment/IAM role if not provided
})

/**
 * Download bundle from S3 or load from filesystem (dev)
 */
export async function loadBundle(appId: string, serverBundleSha: string): Promise<string> {
  const s3Key = `apps/${appId}/bundles/server/${serverBundleSha}.js`
  const localBundlesPath = Deno.env.get('LOCAL_BUNDLES_PATH')

  // Development: Load from filesystem
  if (localBundlesPath) {
    console.log('[BundleLoader] Loading from filesystem:', {
      appId,
      serverBundleSha,
      localBundlesPath,
    })

    const filePath = `${localBundlesPath}/${s3Key}`

    try {
      const bundleCode = await Deno.readTextFile(filePath)
      console.log('[BundleLoader] Bundle loaded from filesystem:', {
        size: bundleCode.length,
        path: filePath,
      })
      return bundleCode
    } catch (error: unknown) {
      const { message } = parseError(error)
      throw new Error(`Bundle not found at ${filePath}: ${message}`)
    }
  }

  // Production: Download from S3
  const bucketName = Deno.env.get('S3_PRIVATE_BUCKET')

  if (!bucketName) {
    throw new Error('S3_PRIVATE_BUCKET environment variable not set')
  }

  console.log('[BundleLoader] Downloading from S3:', { bucket: bucketName, key: s3Key })

  const command = new GetObjectCommand({
    Bucket: bucketName,
    Key: s3Key,
  })

  const response = await s3Client.send(command)

  if (!response.Body) {
    throw new Error(`Bundle not found in S3: ${s3Key}`)
  }

  const bundleCode = await response.Body.transformToString()

  console.log('[BundleLoader] Bundle downloaded from S3:', {
    size: bundleCode.length,
    key: s3Key,
  })

  return bundleCode
}
