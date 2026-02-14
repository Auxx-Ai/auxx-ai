// apps/api/src/lib/s3.ts

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type { Result } from 'neverthrow'
import {
  AWS_ACCESS_KEY_ID,
  AWS_REGION,
  AWS_SECRET_ACCESS_KEY,
  S3_BUCKET_NAME as BUCKET_NAME,
} from '../config'
import type { AppVersionBundleError } from './errors'
import { fromS3 } from './utils'

/**
 * S3 bucket name for app bundles
 */
export const S3_BUCKET_NAME = BUCKET_NAME

/**
 * S3 client instance with credentials
 */
export const s3Client = new S3Client({
  region: AWS_REGION,
  credentials:
    AWS_ACCESS_KEY_ID && AWS_SECRET_ACCESS_KEY
      ? {
          accessKeyId: AWS_ACCESS_KEY_ID,
          secretAccessKey: AWS_SECRET_ACCESS_KEY,
        }
      : undefined, // Falls back to environment/IAM role if not provided
})

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
): Promise<Result<string, AppVersionBundleError>> {
  const command = new PutObjectCommand({
    Bucket: S3_BUCKET_NAME,
    Key: key,
  })

  return await fromS3(getSignedUrl(s3Client, command, { expiresIn }), 'generate-presigned-url')
}
