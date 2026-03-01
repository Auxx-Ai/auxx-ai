// apps/api/src/lib/s3.ts

import { configService } from '@auxx/credentials'
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type { Result } from 'neverthrow'
import type { AppBundleError } from './errors'
import { fromS3 } from './utils'

let _s3Client: S3Client | null = null

/**
 * Lazily initializes and returns the S3 client.
 * Deferred so configService.init() has run before credentials are read.
 */
export function getS3Client(): S3Client {
  if (!_s3Client) {
    const region = configService.get<string>('S3_REGION')!
    const endpoint = configService.get<string>('S3_ENDPOINT')
    const accessKeyId = configService.get<string>('S3_ACCESS_KEY_ID')
    const secretAccessKey = configService.get<string>('S3_SECRET_ACCESS_KEY')

    console.log('[s3] Initializing S3 client:', {
      region,
      endpoint: endpoint || '(default AWS)',
      bucket: configService.get<string>('S3_PRIVATE_BUCKET') || 'auxx-private-local (default)',
      hasAccessKey: !!accessKeyId,
      hasSecretKey: !!secretAccessKey,
    })

    const forcePathStyle = configService.get<string>('S3_FORCE_PATH_STYLE') !== 'false'

    _s3Client = new S3Client({
      region,
      ...(endpoint ? { endpoint, forcePathStyle } : {}),
      credentials: accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined,
    })
  }
  return _s3Client
}

/**
 * Lazily returns the S3 bucket name for app bundles.
 */
export function getS3BucketName(): string {
  return configService.get<string>('S3_PRIVATE_BUCKET')!
}

/**
 * Generate a presigned URL for uploading a file to S3
 *
 * @param key - S3 object key
 * @param expiresIn - Expiration time in seconds (default: 1 hour)
 * @returns Result with presigned upload URL or an error
 */
export async function generatePresignedUploadUrl(
  key: string,
  expiresIn: number = 3600
): Promise<Result<string, AppBundleError>> {
  const command = new PutObjectCommand({
    Bucket: getS3BucketName(),
    Key: key,
  })

  return await fromS3(getSignedUrl(getS3Client(), command, { expiresIn }), 'generate-presigned-url')
}
