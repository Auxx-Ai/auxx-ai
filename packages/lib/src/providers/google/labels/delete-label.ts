// packages/lib/src/providers/google/labels/delete-label.ts

import { createScopedLogger } from '@auxx/logger'
import type { gmail_v1 } from 'googleapis'
import type { UniversalThrottler } from '../../../utils/rate-limiter'
import { executeWithThrottle } from '../shared/utils'

const logger = createScopedLogger('google-delete-label')

/**
 * System labels that cannot be deleted
 */
const SYSTEM_LABELS = ['INBOX', 'SPAM', 'TRASH', 'SENT', 'DRAFT', 'IMPORTANT', 'STARRED', 'UNREAD']

/**
 * Input parameters for deleting a Gmail label
 */
export interface DeleteLabelInput {
  gmail: gmail_v1.Gmail
  labelId: string
  integrationId: string
  throttler: UniversalThrottler
}

/**
 * Deletes a Gmail label
 *
 * @param input - Parameters for deleting a label
 * @returns True if deletion was successful, false if label is a system label or deletion failed
 */
export async function deleteLabel(input: DeleteLabelInput): Promise<boolean> {
  const { gmail, labelId, integrationId, throttler } = input

  // Cannot delete system labels
  if (SYSTEM_LABELS.includes(labelId)) {
    logger.warn('Attempted to delete system label', { labelId, integrationId })
    return false
  }

  logger.info('Deleting Gmail label', { labelId, integrationId })

  try {
    await executeWithThrottle(
      'gmail.labels.delete',
      async () => gmail.users.labels.delete({ userId: 'me', id: labelId }),
      {
        userId: integrationId,
        throttler,
        cost: 5, // Estimate for delete operations
        queue: true,
        priority: 7, // Lower priority for label operations
      }
    )

    logger.info('Gmail label deleted successfully', { labelId, integrationId })
    return true
  } catch (error) {
    logger.error('Failed to delete Gmail label', {
      error: error instanceof Error ? error.message : String(error),
      labelId,
      integrationId,
    })
    return false
  }
}
