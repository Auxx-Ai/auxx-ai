// packages/lib/src/email/inbound/s3-raw-email.ts

import { createScopedLogger } from '@auxx/logger'
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3'

const logger = createScopedLogger('s3-raw-email')

/**
 * inboundEmailRegion is the AWS region used for inbound email storage.
 */
const inboundEmailRegion =
  process.env.INBOUND_EMAIL_QUEUE_REGION || process.env.AWS_REGION || 'us-west-1'

/**
 * s3Client is the shared S3 client for inbound raw-email fetches.
 */
const s3Client = new S3Client({
  region: inboundEmailRegion,
})

/**
 * S3RawEmailStore fetches raw MIME payloads stored by SES in S3.
 */
export class S3RawEmailStore {
  /**
   * getRawEmailBuffer retrieves a raw MIME object from S3 as a Buffer.
   */
  async getRawEmailBuffer(bucket: string, key: string): Promise<Buffer> {
    const response = await s3Client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      })
    )

    if (!response.Body) {
      throw new Error(`Inbound raw email body missing for s3://${bucket}/${key}`)
    }

    const bytes = await response.Body.transformToByteArray()
    const buffer = Buffer.from(bytes)

    logger.info('Fetched raw inbound email from S3', {
      bucket,
      key,
      size: buffer.byteLength,
    })

    return buffer
  }

  /**
   * getRawEmailString retrieves a raw MIME object from S3 as a UTF-8 string.
   */
  async getRawEmailString(bucket: string, key: string): Promise<string> {
    const buffer = await this.getRawEmailBuffer(bucket, key)
    return buffer.toString('utf8')
  }
}
