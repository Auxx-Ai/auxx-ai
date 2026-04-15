// packages/lib/src/recording/bot/webhook-handler.ts

import { createScopedLogger } from '@auxx/logger'
import { err, ok, type Result } from 'neverthrow'
import { UnauthorizedError } from '../../errors'
import { getQueue, Queues } from '../../jobs/queues'
import { getProvider } from './providers'
import type { BotProviderId } from './types'

const logger = createScopedLogger('recording:webhook-handler')

/**
 * Handle an inbound recording webhook from a bot provider.
 * Verifies signature, parses the event, and enqueues a job for async processing.
 */
export async function handleRecordingWebhook(
  providerId: BotProviderId,
  headers: Record<string, string>,
  rawBody: string
): Promise<Result<void, Error>> {
  const provider = getProvider(providerId)

  // Verify webhook signature
  if (!provider.verifyWebhookSignature(headers, rawBody)) {
    logger.warn('Invalid webhook signature', { providerId })
    return err(new UnauthorizedError('Invalid webhook signature'))
  }

  // Parse the webhook payload
  const parseResult = provider.parseWebhook(headers, JSON.parse(rawBody))
  if (parseResult.isErr()) {
    logger.warn('Failed to parse webhook', { providerId, error: parseResult.error.message })
    return err(parseResult.error)
  }

  const event = parseResult.value

  logger.debug('Webhook received', {
    providerId,
    eventType: event.type,
    externalBotId: event.externalBotId,
    status: event.status,
  })

  // Enqueue for async processing (must return <15s to Recall)
  const queue = getQueue(Queues.recordingBotQueue)
  await queue.add(
    'handleRecordingWebhookJob',
    {
      externalBotId: event.externalBotId,
      type: event.type,
      status: event.status,
      subCode: event.subCode,
      metadata: event.metadata,
      timestamp: event.timestamp.toISOString(),
    },
    {
      attempts: 5,
      backoff: { type: 'exponential', delay: 10000 },
    }
  )

  return ok(undefined)
}
