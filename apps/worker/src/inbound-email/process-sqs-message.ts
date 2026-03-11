// apps/worker/src/inbound-email/process-sqs-message.ts

import { InboundEmailProcessor, type SesInboundQueueMessage } from '@auxx/lib/email'
import type { Message } from '@aws-sdk/client-sqs'
import { z } from 'zod'

/**
 * sesInboundQueueMessageSchema validates the SES handoff message body.
 */
const sesInboundQueueMessageSchema = z.object({
  version: z.literal(1),
  provider: z.literal('ses'),
  sesMessageId: z.string().min(1),
  s3Bucket: z.string().min(1),
  s3Key: z.string().min(1),
  recipients: z.array(z.string().min(1)).min(1),
  receivedAt: z.string().min(1),
})

/**
 * inboundEmailProcessor is the shared inbound processor used for all SQS messages.
 */
const inboundEmailProcessor = new InboundEmailProcessor()

/**
 * parseInboundQueueMessage validates the SQS message body into a typed payload.
 */
export function parseInboundQueueMessage(message: Message): SesInboundQueueMessage {
  if (!message.Body) {
    throw new Error('Inbound email SQS message body is missing')
  }

  return sesInboundQueueMessageSchema.parse(JSON.parse(message.Body))
}

/**
 * processInboundEmailQueueMessage validates and processes one SQS handoff message.
 */
export async function processInboundEmailQueueMessage(
  message: Message
): Promise<SesInboundQueueMessage> {
  const queueMessage = parseInboundQueueMessage(message)
  await inboundEmailProcessor.processFromQueueMessage(queueMessage)
  return queueMessage
}
