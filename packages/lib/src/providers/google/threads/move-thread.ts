// packages/lib/src/providers/google/threads/move-thread.ts
import { gmail_v1 } from 'googleapis'
import { UniversalThrottler } from '../../../utils/rate-limiter'
import { handleGmailError } from '../shared/error-handler'
import { modifyWithThrottling } from '../shared/utils'
import { createScopedLogger } from '@auxx/logger'

const logger = createScopedLogger('google-threads:move')

/**
 * Options for moving a thread to a folder/label
 */
export interface MoveThreadOptions {
  gmail: gmail_v1.Gmail
  externalThreadId: string
  destinationLabelId: string
  integrationId: string
  throttler: UniversalThrottler
  threadId?: string
}

/**
 * Move Gmail thread to a label/folder
 * Moving in Gmail means adding the new label and removing INBOX (if applicable)
 */
export async function moveThread(options: MoveThreadOptions): Promise<boolean> {
  const { gmail, externalThreadId, destinationLabelId, integrationId, throttler } = options

  logger.info(`Moving Gmail thread ${externalThreadId} to label ${destinationLabelId}`)

  try {
    await modifyWithThrottling(
      gmail,
      'thread',
      externalThreadId,
      {
        addLabelIds: [destinationLabelId],
        removeLabelIds: ['INBOX'],
      },
      integrationId,
      throttler
    )

    logger.info(`Moved Gmail thread ${externalThreadId} to label ${destinationLabelId}.`)
    return true
  } catch (error: any) {
    logger.error(`Failed to move Gmail thread ${externalThreadId}`, {
      error: error.message,
      status: error.response?.status,
    })
    await handleGmailError(error, 'threads.modify', integrationId)
    return false
  }
}
