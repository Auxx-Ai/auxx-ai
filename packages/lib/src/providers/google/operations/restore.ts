// packages/lib/src/providers/google/operations/restore.ts
import { gmail_v1 } from 'googleapis'
import { createScopedLogger } from '@auxx/logger'
import { getGmailQuotaCost, type UniversalThrottler } from '../../../utils/rate-limiter'
import { executeWithThrottle, modifyWithThrottling } from '../shared/utils'

const logger = createScopedLogger('google-restore')

/**
 * Restore a Gmail message or thread from trash by untrashing and adding back to INBOX
 */
export async function restore(
  gmail: gmail_v1.Gmail,
  externalId: string,
  type: 'message' | 'thread',
  integrationId: string,
  throttler: UniversalThrottler
): Promise<boolean> {
  logger.info(`Restoring Gmail ${type}: ${externalId}`)
  try {
    // First, untrash the item
    const operation = type === 'message' ? 'messages.untrash' : 'threads.untrash'
    const cost =
      type === 'message'
        ? getGmailQuotaCost('messages.untrash')
        : getGmailQuotaCost('threads.untrash')
    await executeWithThrottle(
      `gmail.${operation}`,
      async () =>
        gmail.users[type === 'message' ? 'messages' : 'threads'].untrash({
          userId: 'me',
          id: externalId,
        }),
      {
        userId: integrationId,
        throttler,
        cost,
        queue: true,
        priority: 7, // Lower priority
      }
    )
    // Then, ensure it's not marked as spam and is in the inbox (modify labels)
    await modifyWithThrottling(
      gmail,
      type,
      externalId,
      {
        removeLabelIds: ['SPAM', 'TRASH'],
        addLabelIds: ['INBOX', 'UNREAD'], // Add back to inbox, mark unread
      },
      integrationId,
      throttler
    )
    logger.info(`Gmail ${type} ${externalId} restored.`)
    return true
  } catch (error: any) {
    logger.error(`Failed to restore Gmail ${type} ${externalId}`, {
      error: error.message,
      status: error.response?.status,
    })
    return false
  }
}
