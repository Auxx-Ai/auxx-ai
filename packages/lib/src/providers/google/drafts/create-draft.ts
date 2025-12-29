// packages/lib/src/providers/google/drafts/create-draft.ts
import { gmail_v1 } from 'googleapis'
import { UniversalThrottler } from '../../../utils/rate-limiter'
import { handleGmailError } from '../shared/error-handler'
import { executeWithThrottle } from '../shared/utils'
import { createScopedLogger } from '@auxx/logger'

const logger = createScopedLogger('google-create-draft')

/** Input parameters for creating a Gmail draft */
export interface CreateGmailDraftInput {
  /** Gmail API client instance */
  gmail: gmail_v1.Gmail
  /** RFC 822 formatted email message */
  message: string
  /** Optional thread ID to attach the draft to (for replies) */
  threadId?: string
  /** Integration ID for rate limiting */
  integrationId: string
  /** Rate limiter instance */
  throttler: UniversalThrottler
}

/** Output from creating a Gmail draft */
export interface CreateGmailDraftOutput {
  /** Draft ID returned from Gmail */
  id: string
  /** Optional message ID from the draft */
  messageId?: string
}

/**
 * Creates a new Gmail draft message
 * @param input - Configuration for creating the draft
 * @returns Draft ID and optional message ID
 * @throws Error if draft creation fails or no ID is returned
 */
export async function createGmailDraft(
  input: CreateGmailDraftInput
): Promise<CreateGmailDraftOutput> {
  const { gmail, message, threadId, integrationId, throttler } = input

  const encodedMessage = Buffer.from(message).toString('base64url')

  const requestBody: gmail_v1.Params$Resource$Users$Drafts$Create = {
    userId: 'me',
    requestBody: {
      message: {
        raw: encodedMessage,
        ...(threadId && { threadId }),
      },
    },
  }

  try {
    const response = await executeWithThrottle(
      'gmail.drafts.create',
      async () => gmail.users.drafts.create(requestBody),
      {
        userId: integrationId,
        throttler,
        priority: 3,
      }
    )

    if (!response.data.id) {
      throw new Error('Draft creation failed to return ID.')
    }

    logger.info('Gmail draft created', {
      draftId: response.data.id,
      messageId: response.data.message?.id,
      integrationId,
    })

    return {
      id: response.data.id,
      messageId: response.data.message?.id,
    }
  } catch (error) {
    throw await handleGmailError(error, 'createDraft', integrationId)
  }
}
