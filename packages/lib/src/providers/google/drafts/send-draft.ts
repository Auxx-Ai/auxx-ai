// packages/lib/src/providers/google/drafts/send-draft.ts

import { createScopedLogger } from '@auxx/logger'
import type { gmail_v1 } from 'googleapis'
import type { UniversalThrottler } from '../../../utils/rate-limiter'
import { handleGmailError } from '../shared/error-handler'
import { executeWithThrottle } from '../shared/utils'

const logger = createScopedLogger('google-send-draft')

/** Input parameters for sending a Gmail draft */
export interface SendGmailDraftInput {
  /** Gmail API client instance */
  gmail: gmail_v1.Gmail
  /** Draft ID to send */
  draftId: string
  /** Integration ID for rate limiting */
  integrationId: string
  /** Rate limiter instance */
  throttler: UniversalThrottler
}

/** Output from sending a Gmail draft */
export interface SendGmailDraftOutput {
  /** Message ID of the sent message */
  id: string
  /** Optional thread ID the message belongs to */
  threadId?: string
}

/**
 * Sends an existing Gmail draft
 * @param input - Configuration for sending the draft
 * @returns Message ID and optional thread ID of the sent message
 * @throws Error if send fails or no message ID is returned
 */
export async function sendGmailDraft(input: SendGmailDraftInput): Promise<SendGmailDraftOutput> {
  const { gmail, draftId, integrationId, throttler } = input

  try {
    const response = await executeWithThrottle(
      'gmail.drafts.send',
      async () =>
        gmail.users.drafts.send({
          userId: 'me',
          requestBody: { id: draftId },
        }),
      {
        userId: integrationId,
        throttler,
        priority: 1,
      }
    )

    if (!response.data.id) {
      throw new Error('Send draft did not return sent message ID.')
    }

    logger.info('Gmail draft sent', {
      draftId,
      sentMessageId: response.data.id,
      threadId: response.data.threadId,
      integrationId,
    })

    return {
      id: response.data.id,
      threadId: response.data.threadId,
    }
  } catch (error) {
    throw await handleGmailError(error, 'sendDraft', integrationId)
  }
}
