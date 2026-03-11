// apps/mail-ingress/src/ses-inbound-receiver.ts

import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs'
import { z } from 'zod'

/**
 * inboundRegion is the AWS region used by the SES bridge.
 */
const inboundRegion =
  process.env.INBOUND_EMAIL_QUEUE_REGION || process.env.AWS_REGION || 'us-west-1'

/**
 * sqsClient is the shared SQS client used by the SES bridge Lambda.
 */
const sqsClient = new SQSClient({
  region: inboundRegion,
})

/**
 * sesRecordSchema validates the SES record shape the bridge depends on.
 */
const sesRecordSchema = z.object({
  ses: z.object({
    mail: z.object({
      messageId: z.string().min(1),
      timestamp: z.string().min(1),
    }),
    receipt: z.object({
      recipients: z.array(z.string().min(1)).default([]),
    }),
  }),
})

/**
 * SesInboundQueueMessage is the bridge payload shape sent to SQS.
 */
interface SesInboundQueueMessage {
  version: 1
  provider: 'ses'
  sesMessageId: string
  s3Bucket: string
  s3Key: string
  recipients: string[]
  receivedAt: string
}

/**
 * SesMailPayload is the subset of SES mail metadata used by the bridge.
 */
interface SesMailPayload {
  messageId: string
  timestamp: string
}

/**
 * SesReceiptPayload is the subset of SES receipt metadata used by the bridge.
 */
interface SesReceiptPayload {
  recipients: string[]
}

/**
 * buildSesInboundQueueMessage converts SES mail/receipt data into the SQS handoff message.
 */
export function buildSesInboundQueueMessage(params: {
  mail: SesMailPayload
  receipt: SesReceiptPayload
}): SesInboundQueueMessage {
  const queueBucket = process.env.INBOUND_EMAIL_BUCKET
  const keyPrefix = process.env.INBOUND_EMAIL_KEY_PREFIX || 'ses/raw'

  if (!queueBucket) {
    throw new Error('INBOUND_EMAIL_BUCKET is required')
  }

  return {
    version: 1,
    provider: 'ses',
    sesMessageId: params.mail.messageId,
    s3Bucket: queueBucket,
    s3Key: `${keyPrefix}/${params.mail.messageId}`,
    recipients: params.receipt.recipients ?? [],
    receivedAt: params.mail.timestamp ?? new Date().toISOString(),
  }
}

/**
 * handler validates the SES event and publishes the S3 handoff message to SQS.
 */
export async function handler(event: { Records?: unknown[] }) {
  const queueUrl = process.env.INBOUND_EMAIL_QUEUE_URL
  if (!queueUrl) {
    throw new Error('INBOUND_EMAIL_QUEUE_URL is required')
  }

  const records = Array.isArray(event.Records) ? event.Records : []
  if (records.length === 0) {
    throw new Error('SES event did not include any records')
  }

  const payloads = records.map((record) => {
    const parsedRecord = sesRecordSchema.parse(record)
    return buildSesInboundQueueMessage({
      mail: {
        messageId: parsedRecord.ses.mail.messageId,
        timestamp: parsedRecord.ses.mail.timestamp,
      },
      receipt: {
        recipients: parsedRecord.ses.receipt.recipients,
      },
    })
  })

  for (const payload of payloads) {
    await sqsClient.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify(payload),
      })
    )
  }

  return {
    ok: true,
    count: payloads.length,
    sesMessageIds: payloads.map((payload) => payload.sesMessageId),
  }
}
