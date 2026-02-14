// packages/lib/src/providers/google/labels/get-labels.ts

import { createScopedLogger } from '@auxx/logger'
import type { gmail_v1 } from 'googleapis'
import { getGmailQuotaCost, type UniversalThrottler } from '../../../utils/rate-limiter'
import { handleGmailError } from '../shared/error-handler'
import { executeWithThrottle } from '../shared/utils'

const logger = createScopedLogger('google-get-labels')

/**
 * Input parameters for getting Gmail labels
 */
export interface GetLabelsInput {
  gmail: gmail_v1.Gmail
  integrationId: string
  throttler: UniversalThrottler
}

/**
 * Gets all labels for the authenticated Gmail user
 *
 * @param input - Parameters for getting labels
 * @returns Array of Gmail labels
 */
export async function getLabels(input: GetLabelsInput): Promise<gmail_v1.Schema$Label[]> {
  const { gmail, integrationId, throttler } = input

  logger.info('Getting Gmail labels', { integrationId })

  try {
    const response = await executeWithThrottle(
      'gmail.labels.list',
      async () => gmail.users.labels.list({ userId: 'me' }),
      {
        userId: integrationId,
        throttler,
        cost: getGmailQuotaCost('labels.list'), // 1 quota unit
        queue: true,
        priority: 7, // Lower priority for label operations
      }
    )

    logger.info('Successfully retrieved Gmail labels', {
      integrationId,
      labelCount: response.data.labels?.length || 0,
    })

    return response.data.labels || []
  } catch (error) {
    logger.error('Failed to get Gmail labels', {
      error: error instanceof Error ? error.message : String(error),
      integrationId,
    })
    throw await handleGmailError(error, 'getLabels', integrationId)
  }
}
