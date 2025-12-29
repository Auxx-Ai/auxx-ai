// packages/lib/src/providers/google/drafts/update-draft.ts
import { gmail_v1 } from 'googleapis'
import { UniversalThrottler } from '../../../utils/rate-limiter'
import { handleGmailError } from '../shared/error-handler'
import { executeWithThrottle } from '../shared/utils'
import { createScopedLogger } from '@auxx/logger'

const logger = createScopedLogger('google-update-draft')

/** Input parameters for updating a Gmail draft */
export interface UpdateGmailDraftInput {
  /** Gmail API client instance */
  gmail: gmail_v1.Gmail
  /** Draft ID to update */
  draftId: string
  /** RFC 822 formatted email message (replaces entire draft content) */
  message: string
  /** Integration ID for rate limiting */
  integrationId: string
  /** Rate limiter instance */
  throttler: UniversalThrottler
}

/**
 * Updates an existing Gmail draft with new content
 * Note: This replaces the entire draft content, not a partial update
 * @param input - Configuration for updating the draft
 * @returns True if update was successful
 * @throws Error if draft update fails
 */
export async function updateGmailDraft(input: UpdateGmailDraftInput): Promise<boolean> {
  const { gmail, draftId, message, integrationId, throttler } = input

  const encodedMessage = Buffer.from(message).toString('base64url')

  try {
    await executeWithThrottle(
      'gmail.drafts.update',
      async () =>
        gmail.users.drafts.update({
          userId: 'me',
          id: draftId,
          requestBody: {
            message: { raw: encodedMessage },
          },
        }),
      {
        userId: integrationId,
        throttler,
        priority: 3,
      }
    )

    logger.info('Gmail draft updated', {
      draftId,
      integrationId,
    })

    return true
  } catch (error) {
    throw await handleGmailError(error, 'updateDraft', integrationId)
  }
}
