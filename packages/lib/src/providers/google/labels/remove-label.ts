// packages/lib/src/providers/google/labels/remove-label.ts

import { createScopedLogger } from '@auxx/logger'
import type { gmail_v1 } from 'googleapis'
import type { UniversalThrottler } from '../../../utils/rate-limiter'
import { handleGmailError } from '../shared/error-handler'
import { modifyWithThrottling } from '../shared/utils'

const logger = createScopedLogger('google-remove-label')

/**
 * Input parameters for removing a label from a message or thread
 */
export interface RemoveLabelInput {
  gmail: gmail_v1.Gmail
  labelId: string
  externalId: string
  type: 'message' | 'thread'
  integrationId: string
  throttler: UniversalThrottler
}

/**
 * Removes a label from a Gmail message or thread
 *
 * @param input - Parameters for removing a label
 * @returns True if label was removed successfully, false otherwise
 */
export async function removeLabel(input: RemoveLabelInput): Promise<boolean> {
  const { gmail, labelId, externalId, type, integrationId, throttler } = input

  logger.info('Removing Gmail label', { labelId, externalId, type, integrationId })

  try {
    await modifyWithThrottling(
      gmail,
      type,
      externalId,
      { removeLabelIds: [labelId] },
      integrationId,
      throttler
    )

    logger.info('Gmail label removed successfully', { labelId, externalId, type, integrationId })
    return true
  } catch (error) {
    logger.error('Failed to remove Gmail label', {
      error: error instanceof Error ? error.message : String(error),
      labelId,
      externalId,
      type,
      integrationId,
    })
    return false
  }
}
