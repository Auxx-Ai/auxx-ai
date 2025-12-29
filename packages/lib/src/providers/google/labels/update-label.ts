// packages/lib/src/providers/google/labels/update-label.ts
import { gmail_v1 } from 'googleapis'
import { UniversalThrottler, getGmailQuotaCost } from '../../../utils/rate-limiter'
import { handleGmailError } from '../shared/error-handler'
import { executeWithThrottle } from '../shared/utils'
import { createScopedLogger } from '@auxx/logger'

const logger = createScopedLogger('google-update-label')

/**
 * Input parameters for updating a Gmail label
 */
export interface UpdateLabelInput {
  gmail: gmail_v1.Gmail
  labelId: string
  name?: string
  color?: string
  visible?: boolean
  integrationId: string
  throttler: UniversalThrottler
}

/**
 * Updates an existing Gmail label
 *
 * @param input - Parameters for updating a label
 * @returns True if update was successful, false otherwise
 */
export async function updateLabel(input: UpdateLabelInput): Promise<boolean> {
  const { gmail, labelId, name, color, visible, integrationId, throttler } = input

  logger.info('Updating Gmail label', { labelId, integrationId })

  try {
    const updateBody: gmail_v1.Schema$Label = {}

    if (name !== undefined) {
      updateBody.name = name
    }

    if (visible !== undefined) {
      updateBody.labelListVisibility = visible ? 'labelShow' : 'labelHide'
      updateBody.messageListVisibility = visible ? 'show' : 'hide'
    }

    // TODO: Handle color updates if needed
    // if (color !== undefined) {
    //   updateBody.color = mapColorToGmail(color)
    // }

    if (Object.keys(updateBody).length === 0) {
      logger.info('No changes requested for label update', { labelId, integrationId })
      return true // No changes requested
    }

    await executeWithThrottle(
      'gmail.labels.update',
      async () =>
        gmail.users.labels.patch({
          // Use patch for partial updates
          userId: 'me',
          id: labelId,
          requestBody: updateBody,
        }),
      {
        userId: integrationId,
        throttler,
        cost: getGmailQuotaCost('labels.update'), // 5 quota units
        queue: true,
        priority: 7, // Lower priority for label operations
      }
    )

    logger.info('Gmail label updated successfully', { labelId, integrationId })
    return true
  } catch (error) {
    logger.error('Failed to update Gmail label', {
      error: error instanceof Error ? error.message : String(error),
      labelId,
      integrationId,
    })
    return false
  }
}
