// packages/lib/src/providers/google/labels/create-label.ts

import { createScopedLogger } from '@auxx/logger'
import type { gmail_v1 } from 'googleapis'
import { getGmailQuotaCost, type UniversalThrottler } from '../../../utils/rate-limiter'
import { handleGmailError } from '../shared/error-handler'
import { executeWithThrottle } from '../shared/utils'

const logger = createScopedLogger('google-create-label')

/**
 * Input parameters for creating a Gmail label
 */
export interface CreateLabelInput {
  gmail: gmail_v1.Gmail
  name: string
  color?: string
  visible?: boolean
  integrationId: string
  throttler: UniversalThrottler
}

/**
 * Creates a new label in Gmail
 *
 * @param input - Parameters for creating a label
 * @returns The created Gmail label
 * @throws {Error} If label creation fails
 */
export async function createLabel(input: CreateLabelInput): Promise<gmail_v1.Schema$Label> {
  const { gmail, name, color, visible, integrationId, throttler } = input

  logger.info('Creating Gmail label', { name, integrationId })

  try {
    // Basic visibility mapping
    const labelListVisibility = visible === false ? 'labelHide' : 'labelShow'
    const messageListVisibility = visible === false ? 'hide' : 'show'

    const response = await executeWithThrottle(
      'gmail.labels.create',
      async () =>
        gmail.users.labels.create({
          userId: 'me',
          requestBody: {
            name,
            labelListVisibility,
            messageListVisibility,
            // TODO: Map color string to Gmail's background/text color objects if provided
            // color: color ? mapColorToGmail(color) : undefined,
          },
        }),
      {
        userId: integrationId,
        throttler,
        cost: getGmailQuotaCost('labels.create'), // 5 quota units
        queue: true,
        priority: 7, // Lower priority for label operations
      }
    )

    logger.info('Gmail label created successfully', {
      labelId: response.data.id,
      name,
      integrationId,
    })

    return response.data
  } catch (error) {
    logger.error('Failed to create Gmail label', {
      error: error instanceof Error ? error.message : String(error),
      name,
      integrationId,
    })
    throw await handleGmailError(error, 'createLabel', integrationId)
  }
}
