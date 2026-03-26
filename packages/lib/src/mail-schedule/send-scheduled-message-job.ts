// packages/lib/src/mail-schedule/send-scheduled-message-job.ts

import { database as db } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { DraftService } from '../drafts/draft-service'
import type { JobContext } from '../jobs/types/job-context'
import { MessageSenderService } from '../messages/message-sender.service'
import type { SendMessageInput } from '../messages/types/message-sending.types'
import { ProviderRegistryService } from '../providers/provider-registry-service'
import { findScheduledMessageById, updateScheduledMessageStatus } from './scheduled-message'

const logger = createScopedLogger('send-scheduled-message-job')

export interface SendScheduledMessageJobData {
  scheduledMessageId: string
  organizationId: string
}

/**
 * BullMQ job handler that sends a previously scheduled message.
 * Fetches the ScheduledMessage record, validates it's still PENDING,
 * then delegates to MessageSenderService.sendMessage().
 */
export async function sendScheduledMessageJob(
  ctx: JobContext<SendScheduledMessageJobData>
): Promise<{ success: boolean; messageId?: string }> {
  const { scheduledMessageId, organizationId } = ctx.data

  logger.info('Processing scheduled message', {
    scheduledMessageId,
    organizationId,
    jobId: ctx.jobId,
  })

  // 1. Fetch the scheduled message
  const scheduled = await findScheduledMessageById(db, scheduledMessageId, organizationId)
  if (!scheduled) {
    logger.warn('Scheduled message not found, skipping', { scheduledMessageId })
    return { success: false }
  }

  // 2. Only process PENDING messages
  if (scheduled.status !== 'PENDING') {
    logger.info('Scheduled message is not PENDING, skipping', {
      scheduledMessageId,
      status: scheduled.status,
    })
    return { success: false }
  }

  // 3. Mark as PROCESSING
  await updateScheduledMessageStatus(db, scheduledMessageId, 'PROCESSING')

  try {
    // 4. Parse the send payload and send
    const sendPayload = scheduled.sendPayload as SendMessageInput
    const providerRegistry = new ProviderRegistryService(organizationId)
    const messageSender = new MessageSenderService(organizationId, providerRegistry, db)

    const sentMessage = await messageSender.sendMessage(sendPayload)

    // 5. Mark as SENT
    await updateScheduledMessageStatus(db, scheduledMessageId, 'SENT', {
      attempts: scheduled.attempts + 1,
    })

    // 6. Clean up draft after successful send
    if (scheduled.draftId) {
      try {
        const draftService = new DraftService(db, organizationId, scheduled.createdById)
        await draftService.markAsSent(scheduled.draftId)
      } catch (draftError) {
        // Non-fatal: message was sent, draft cleanup failure is acceptable
        logger.warn('Failed to clean up draft after scheduled send', {
          scheduledMessageId,
          draftId: scheduled.draftId,
          error: draftError instanceof Error ? draftError.message : String(draftError),
        })
      }
    }

    logger.info('Scheduled message sent successfully', {
      scheduledMessageId,
      messageId: sentMessage.id,
      threadId: sentMessage.threadId,
    })

    return { success: true, messageId: sentMessage.id }
  } catch (error) {
    const failureReason = error instanceof Error ? error.message : String(error)

    // 6. Mark as FAILED
    await updateScheduledMessageStatus(db, scheduledMessageId, 'FAILED', {
      failureReason,
      attempts: scheduled.attempts + 1,
    })

    logger.error('Failed to send scheduled message', {
      scheduledMessageId,
      error: failureReason,
      attempts: scheduled.attempts + 1,
    })

    throw error // Re-throw so BullMQ handles retries
  }
}
