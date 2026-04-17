// packages/lib/src/ingest/batch-store-messages.ts

import { v4 as uuidv4 } from 'uuid'
import { type IngestContext, resetBatchCaches } from './context'
import { storeMessage } from './store-message'
import type { MessageData } from './types'

export interface BatchStoreOptions {
  batchId?: string
  isInitialSync?: boolean
}

/**
 * Store a batch of messages with initial-sync tracking and chronological
 * ordering. Chronological ordering matters for selective mode: we rely on
 * earlier outbound messages to "open" recipients for later inbound ones.
 *
 * Returns the count of successfully stored messages. Failures are logged
 * and skipped so a single bad message can't poison a whole batch.
 */
export async function batchStoreMessages(
  ctx: IngestContext,
  messages: MessageData[],
  options: BatchStoreOptions = {}
): Promise<number> {
  if (messages.length === 0) return 0

  const organizationId = messages[0]?.organizationId
  if (!organizationId) {
    ctx.logger.error('No organizationId found in batch messages')
    return 0
  }

  const actualBatchId = options.batchId || uuidv4()
  const isInitialSync = options.isInitialSync ?? false

  if (isInitialSync) {
    ctx.isInitialSync = true
    await ctx.selectiveCache.markBatchProcessing(organizationId, actualBatchId)
  }

  resetBatchCaches(ctx)

  const sortedMessages = [...messages].sort(
    (a, b) => (a.sentAt?.getTime() || 0) - (b.sentAt?.getTime() || 0)
  )

  ctx.logger.info(`Starting batch store for ${messages.length} messages (sorted chronologically)`, {
    batchId: actualBatchId,
    isInitialSync,
    organizationId,
  })

  let successCount = 0
  for (const message of sortedMessages) {
    try {
      await storeMessage(ctx, message)
      successCount++

      if (isInitialSync && !message.isInbound) {
        const recipients = [...message.to, ...(message.cc || []), ...(message.bcc || [])]
        const recipientIdentifiers = recipients
          .map((r) => r?.identifier)
          .filter(Boolean) as string[]

        if (recipientIdentifiers.length > 0) {
          await ctx.selectiveCache.markMultipleSentToRecipients(
            recipientIdentifiers,
            organizationId
          )
        }
      }
    } catch (error) {
      ctx.logger.error('Error storing message in batch:', {
        error: (error as Error).message,
        externalId: message.externalId,
        batchId: actualBatchId,
      })
    }
  }

  if (isInitialSync) {
    await ctx.selectiveCache.completeBatch(organizationId, actualBatchId, successCount)
    ctx.isInitialSync = false
  }

  ctx.logger.info(`Batch store completed: ${successCount} of ${messages.length} messages stored.`, {
    batchId: actualBatchId,
    organizationId,
  })

  return successCount
}
