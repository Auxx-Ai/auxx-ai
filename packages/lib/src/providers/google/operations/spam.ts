// packages/lib/src/providers/google/operations/spam.ts

import { createScopedLogger } from '@auxx/logger'
import type { gmail_v1 } from 'googleapis'
import type { UniversalThrottler } from '../../../utils/rate-limiter'
import { modifyWithThrottling } from '../shared/utils'

const logger = createScopedLogger('google-spam')

/**
 * Mark a Gmail message or thread as spam by adding SPAM label and removing INBOX label
 */
export async function markAsSpam(
  gmail: gmail_v1.Gmail,
  externalId: string,
  type: 'message' | 'thread',
  integrationId: string,
  throttler: UniversalThrottler
): Promise<boolean> {
  logger.info(`Marking Gmail ${type} as spam: ${externalId}`)
  try {
    // Add SPAM label, remove INBOX
    await modifyWithThrottling(
      gmail,
      type,
      externalId,
      {
        addLabelIds: ['SPAM'],
        removeLabelIds: ['INBOX'],
      },
      integrationId,
      throttler
    )
    logger.info(`Gmail ${type} ${externalId} marked as spam.`)
    return true
  } catch (error: any) {
    logger.error(`Failed to mark Gmail ${type} ${externalId} as spam`, {
      error: error.message,
      status: error.response?.status,
    })
    return false
  }
}
