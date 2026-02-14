// packages/lib/src/providers/google/threads/update-status.ts

import { createScopedLogger } from '@auxx/logger'
import type { gmail_v1 } from 'googleapis'
import type { UniversalThrottler } from '../../../utils/rate-limiter'
import { MessageStatus } from '../../integration-provider.interface'
import { handleGmailError } from '../shared/error-handler'
import { modifyWithThrottling } from '../shared/utils'

const logger = createScopedLogger('google-threads:update-status')

/**
 * Options for updating thread status
 */
export interface UpdateThreadStatusOptions {
  gmail: gmail_v1.Gmail
  externalThreadId: string
  status: MessageStatus
  integrationId: string
  throttler: UniversalThrottler
  threadId?: string
}

/**
 * Update Gmail thread status (mark as read/unread/starred/important)
 */
export async function updateThreadStatus(options: UpdateThreadStatusOptions): Promise<boolean> {
  const { gmail, externalThreadId, status, integrationId, throttler } = options

  logger.info(`Updating Gmail thread ${externalThreadId} status to ${status}`)

  const reqBody: gmail_v1.Schema$ModifyThreadRequest = { addLabelIds: [], removeLabelIds: [] }

  switch (status) {
    case MessageStatus.READ:
      reqBody.removeLabelIds?.push('UNREAD')
      break
    case MessageStatus.UNREAD:
      reqBody.addLabelIds?.push('UNREAD')
      break
    case MessageStatus.IMPORTANT:
      reqBody.addLabelIds?.push('IMPORTANT')
      break
    case MessageStatus.STARRED:
      reqBody.addLabelIds?.push('STARRED')
      break
    // Archive/Spam/Trash handled by specific methods
    default:
      logger.warn(`Unsupported thread status update via updateThreadStatus: ${status}`)
      return false
  }

  if (reqBody.addLabelIds?.length === 0 && reqBody.removeLabelIds?.length === 0) return true // No change

  try {
    await modifyWithThrottling(gmail, 'thread', externalThreadId, reqBody, integrationId, throttler)

    logger.info(`Updated Gmail thread ${externalThreadId} status.`)
    return true
  } catch (error: any) {
    logger.error(`Failed to update Gmail thread ${externalThreadId} status`, {
      error: error.message,
      status: error.response?.status,
    })
    await handleGmailError(error, 'threads.modify', integrationId)
    return false
  }
}
