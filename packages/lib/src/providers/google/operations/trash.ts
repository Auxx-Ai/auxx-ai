// packages/lib/src/providers/google/operations/trash.ts
import { gmail_v1 } from 'googleapis'
import { createScopedLogger } from '@auxx/logger'
import { getGmailQuotaCost, type UniversalThrottler } from '../../../utils/rate-limiter'
import { executeWithThrottle } from '../shared/utils'

const logger = createScopedLogger('google-trash')

/**
 * Move a Gmail message or thread to trash using the trash endpoint
 */
export async function trash(
  gmail: gmail_v1.Gmail,
  externalId: string,
  type: 'message' | 'thread',
  integrationId: string,
  throttler: UniversalThrottler
): Promise<boolean> {
  logger.info(`Trashing Gmail ${type}: ${externalId}`)
  try {
    // Use the specific trash endpoint
    const operation = type === 'message' ? 'messages.trash' : 'threads.trash'
    const cost =
      type === 'message'
        ? getGmailQuotaCost('messages.trash')
        : getGmailQuotaCost('threads.trash')
    await executeWithThrottle(
      `gmail.${operation}`,
      async () =>
        gmail.users[type === 'message' ? 'messages' : 'threads'].trash({
          userId: 'me',
          id: externalId,
        }),
      {
        userId: integrationId,
        throttler,
        cost,
        queue: true,
        priority: 7, // Lower priority for trash operations
      }
    )
    logger.info(`Gmail ${type} ${externalId} trashed.`)
    return true
  } catch (error: any) {
    logger.error(`Failed to trash Gmail ${type} ${externalId}`, {
      error: error.message,
      status: error.response?.status,
    })
    return false
  }
}
