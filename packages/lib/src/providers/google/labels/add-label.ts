// packages/lib/src/providers/google/labels/add-label.ts

import { createScopedLogger } from '@auxx/logger'
import type { gmail_v1 } from 'googleapis'
import type { UniversalThrottler } from '../../../utils/rate-limiter'
import { handleGmailError } from '../shared/error-handler'
import { modifyWithThrottling } from '../shared/utils'

const logger = createScopedLogger('google-add-label')

/**
 * Input parameters for adding a label to a message or thread
 */
export interface AddLabelInput {
  gmail: gmail_v1.Gmail
  labelId: string
  externalId: string
  type: 'message' | 'thread'
  integrationId: string
  throttler: UniversalThrottler
}

/**
 * Adds a label to a Gmail message or thread
 *
 * @param input - Parameters for adding a label
 * @returns True if label was added successfully, false otherwise
 */
export async function addLabel(input: AddLabelInput): Promise<boolean> {
  const { gmail, labelId, externalId, type, integrationId, throttler } = input

  logger.info('Adding Gmail label', { labelId, externalId, type, integrationId })

  try {
    await modifyWithThrottling(
      gmail,
      type,
      externalId,
      { addLabelIds: [labelId] },
      integrationId,
      throttler
    )

    logger.info('Gmail label added successfully', { labelId, externalId, type, integrationId })
    return true
  } catch (error) {
    logger.error('Failed to add Gmail label', {
      error: error instanceof Error ? error.message : String(error),
      labelId,
      externalId,
      type,
      integrationId,
    })
    return false
  }
}
