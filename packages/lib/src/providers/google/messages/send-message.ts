// packages/lib/src/providers/google/messages/send-message.ts

import { createScopedLogger } from '@auxx/logger'
import type { gmail_v1 } from 'googleapis'
import type { UniversalThrottler } from '../../../utils/rate-limiter'
import { handleGmailError } from '../shared/error-handler'
import { executeWithThrottle } from '../shared/utils'

const logger = createScopedLogger('google-send-message')

export interface SendGmailMessageInput {
  gmail: gmail_v1.Gmail
  message: string // RFC 822 formatted
  threadId?: string
  integrationId: string
  throttler: UniversalThrottler
}

export interface SendGmailMessageOutput {
  id: string
  threadId?: string
  historyId?: string
  labelIds: string[]
}

/**
 * Sends a message via Gmail API with rate limiting
 *
 * @param input - Send message parameters
 * @returns Message details including ID and thread ID
 * @throws {Error} If send fails or API returns invalid response
 */
export async function sendGmailMessage(
  input: SendGmailMessageInput
): Promise<SendGmailMessageOutput> {
  const { gmail, message, threadId, integrationId, throttler } = input

  // Convert to base64url format required by Gmail API
  const encodedMessage = Buffer.from(message)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

  const requestBody: gmail_v1.Params$Resource$Users$Messages$Send = {
    userId: 'me',
    requestBody: {
      raw: encodedMessage,
      ...(threadId && { threadId }),
    },
  }

  try {
    const response = await executeWithThrottle(
      'gmail.messages.send',
      async () => gmail.users.messages.send(requestBody),
      {
        userId: integrationId,
        throttler,
        priority: 1, // High priority for sending
      }
    )

    if (!response.data.id) {
      throw new Error('Gmail API did not return a message ID after sending.')
    }

    logger.info('Gmail message sent successfully', {
      messageId: response.data.id,
      threadId: response.data.threadId,
      historyId: response.data.historyId,
      integrationId,
    })

    return {
      id: response.data.id,
      threadId: response.data.threadId || undefined,
      historyId: response.data.historyId || undefined,
      labelIds: response.data.labelIds || [],
    }
  } catch (error) {
    throw await handleGmailError(error, 'sendMessage', integrationId)
  }
}
