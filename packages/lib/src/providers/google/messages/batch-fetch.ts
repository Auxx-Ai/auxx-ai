// packages/lib/src/providers/google/messages/batch-fetch.ts
import { gmail_v1 } from 'googleapis'
import parse from 'gmail-api-parse-message'
import { UniversalThrottler, getGmailQuotaCost } from '../../../utils/rate-limiter'
import { executeWithThrottle } from '../shared/utils'
import { generateMimeBoundary } from '@auxx/lib/utils'
import { handleGmailError } from '../shared/error-handler'
import { createScopedLogger } from '@auxx/logger'
import type { ParsedGmailMessage, GmailMessageWithPayload } from '../types'

const logger = createScopedLogger('google-batch-fetch')

const BATCH_LIMIT = 50 // Maximum messages per batch request
const INTER_BATCH_DELAY_MS = 250 // Delay between batches to prevent rate limiting
const BATCH_REQUEST_TIMEOUT_MS = 30000 // 30 second timeout for each batch request

/**
 * Input parameters for batch message fetching
 */
export interface GetMessagesBatchInput {
  messageIds: string[]
  integrationId: string
  throttler: UniversalThrottler
  accessToken: string
}

/**
 * Wrap a promise with a timeout
 * @param promise - Promise to wrap
 * @param timeoutMs - Timeout in milliseconds
 * @param operationName - Name of the operation for error messages
 * @returns Promise that rejects if timeout is exceeded
 */
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operationName: string
): Promise<T> {
  let timeoutId: NodeJS.Timeout
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`${operationName} timed out after ${timeoutMs}ms`)),
      timeoutMs
    )
  })

  try {
    const result = await Promise.race([promise, timeoutPromise])
    clearTimeout(timeoutId!)
    return result
  } catch (error) {
    clearTimeout(timeoutId!)
    throw error
  }
}

/**
 * Fetches multiple Gmail messages in batches using Gmail batch API
 * @param input - Batch fetch parameters
 * @returns Array of parsed Gmail messages
 */
export async function getMessagesBatch(
  input: GetMessagesBatchInput
): Promise<ParsedGmailMessage[]> {
  const { messageIds, integrationId, throttler, accessToken } = input

  if (messageIds.length === 0) return []

  logger.info('Starting batch fetch', {
    totalMessages: messageIds.length,
    integrationId,
  })

  let limitedMessageIds = messageIds
  if (messageIds.length > 1000) {
    logger.warn('Limiting batch fetch to 1000 messages', {
      requested: messageIds.length,
      integrationId,
    })
    limitedMessageIds = messageIds.slice(0, 1000)
  }

  const allMessages: ParsedGmailMessage[] = []
  const totalBatches = Math.ceil(limitedMessageIds.length / BATCH_LIMIT)

  // Process in chunks of BATCH_LIMIT with delays between batches
  for (let i = 0; i < limitedMessageIds.length; i += BATCH_LIMIT) {
    const batchIds = limitedMessageIds.slice(i, i + BATCH_LIMIT)
    const batchNumber = Math.floor(i / BATCH_LIMIT) + 1

    logger.info('Processing batch', {
      batchNumber,
      totalBatches,
      size: batchIds.length,
      integrationId,
    })

    try {
      // Wrap the entire batch request with a timeout
      const batchResponses = await withTimeout(
        executeBatchRequest(
          batchIds,
          '/gmail/v1/users/me/messages',
          accessToken,
          integrationId,
          throttler
        ),
        BATCH_REQUEST_TIMEOUT_MS,
        `Batch ${batchNumber}/${totalBatches}`
      )

      logger.info('Batch request completed', {
        batchNumber,
        totalBatches,
        responsesReceived: batchResponses.length,
        integrationId,
      })

      const messages = batchResponses
        .map((response) => {
          if (isBatchError(response)) {
            logger.warn('Batch item error', {
              error: response.error,
              integrationId,
            })
            return undefined
          }

          if (
            response &&
            typeof response === 'object' &&
            response.id &&
            response.threadId &&
            response.payload
          ) {
            return parseGmailMessage(response as GmailMessageWithPayload)
          }

          return undefined
        })
        .filter((msg): msg is ParsedGmailMessage => msg !== undefined)

      allMessages.push(...messages)

      logger.info('Batch parsed', {
        batchNumber,
        totalBatches,
        messagesParsed: messages.length,
        totalSoFar: allMessages.length,
        integrationId,
      })

      // Add delay between batches (except for the last batch)
      if (batchNumber < totalBatches) {
        logger.debug('Waiting between batches', {
          delayMs: INTER_BATCH_DELAY_MS,
          nextBatch: batchNumber + 1,
          integrationId,
        })
        await new Promise((resolve) => setTimeout(resolve, INTER_BATCH_DELAY_MS))
      }
    } catch (error: any) {
      // Check if it's a timeout error
      const isTimeout = error?.message?.includes('timed out')
      if (isTimeout) {
        logger.error('Batch fetch timed out', {
          error: error.message,
          batchNumber,
          totalBatches,
          messagesProcessed: allMessages.length,
          integrationId,
        })
        // Continue with next batch on timeout
        continue
      }

      // Check if it's a rate limit error
      const isRateLimit =
        error?.message?.includes('429') ||
        error?.message?.includes('rateLimitExceeded') ||
        error?.message?.includes('Too many concurrent requests')

      if (isRateLimit) {
        logger.error('Rate limit hit during batch fetch, stopping', {
          error: error.message,
          batchNumber,
          totalBatches,
          messagesProcessed: allMessages.length,
          integrationId,
        })
        // Stop processing more batches if we hit rate limit
        break
      }

      logger.error('Batch fetch failed', {
        error: error.message || error,
        batchNumber,
        totalBatches,
        integrationId,
      })
      // Continue with next batch for other errors
    }
  }

  logger.info('Batch fetch completed', {
    totalRequested: limitedMessageIds.length,
    totalFetched: allMessages.length,
    integrationId,
  })

  return allMessages
}

/**
 * Execute Gmail batch request using the batch API endpoint
 * @param ids - Message IDs to fetch
 * @param endpoint - Gmail API endpoint path
 * @param accessToken - OAuth access token
 * @param integrationId - Integration identifier for throttling
 * @param throttler - Rate limiter instance
 * @returns Array of parsed batch responses
 */
async function executeBatchRequest(
  ids: string[],
  endpoint: string,
  accessToken: string,
  integrationId: string,
  throttler: UniversalThrottler
): Promise<any[]> {
  if (!ids.length) return []

  logger.debug('Executing batch request', {
    messageCount: ids.length,
    integrationId,
  })

  const boundary = generateMimeBoundary()
  let batchRequestBody = ''

  ids.forEach((id) => {
    batchRequestBody += `--${boundary}\n`
    batchRequestBody += `Content-Type: application/http\n\n`
    batchRequestBody += `GET ${endpoint}/${id}?format=full\n\n`
  })

  batchRequestBody += `--${boundary}--`

  try {
    logger.debug('Calling executeWithThrottle', { integrationId })

    const res = await executeWithThrottle(
      'gmail.messages.batchGet',
      async () =>
        fetch('https://gmail.googleapis.com/batch/gmail/v1', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': `multipart/mixed; boundary=${boundary}`,
            'Accept-Encoding': 'gzip',
            'User-Agent': 'AuxxGoogleProvider/1.0',
          },
          body: batchRequestBody,
        }),
      {
        userId: integrationId,
        throttler,
        cost: getGmailQuotaCost('messages.batchGet'),
        queue: true,
        priority: 5,
      }
    )

    logger.debug('executeWithThrottle completed', {
      status: res.status,
      ok: res.ok,
      integrationId,
    })

    if (!res.ok) {
      if (res.status === 401) {
        throw await handleGmailError(
          new Error(`Batch request unauthorized: ${res.statusText}`),
          'batch_request',
          integrationId
        )
      }
      throw new Error(`Batch request failed: ${res.status} ${res.statusText}`)
    }

    const contentType = res.headers.get('Content-Type')
    const responseText = await res.text()

    logger.debug('Parsing batch response', {
      responseLength: responseText.length,
      integrationId,
    })

    return parseBatchResponse(responseText, contentType)
  } catch (error) {
    logger.error('executeBatchRequest failed', {
      error: error instanceof Error ? error.message : error,
      integrationId,
    })
    throw await handleGmailError(error, 'batch_request', integrationId)
  }
}

/**
 * Parse Gmail batch API multipart/mixed response
 * @param batchResponseText - Raw batch response body
 * @param contentTypeHeader - Content-Type header value
 * @returns Array of parsed response objects
 */
function parseBatchResponse(batchResponseText: string, contentTypeHeader: string | null): any[] {
  if (!contentTypeHeader) {
    throw new Error('Missing Content-Type in batch response')
  }

  const boundaryMatch = contentTypeHeader.match(/boundary=(?:"([^"]+)"|([^;]+))/)
  if (!boundaryMatch) {
    throw new Error('Boundary not found in batch response')
  }

  const boundary = boundaryMatch[1] || boundaryMatch[2]
  const parts = batchResponseText.split(`--${boundary}`)
  const results: any[] = []

  for (let i = 1; i < parts.length - 1; i++) {
    const part = parts[i].trim()
    if (!part) continue

    const jsonStartIndex = part.indexOf('{')
    if (jsonStartIndex === -1) continue

    const jsonResponse = part.substring(jsonStartIndex)

    try {
      const parsedJson = JSON.parse(jsonResponse)
      results.push(parsedJson)
    } catch (error) {
      results.push({
        error: {
          code: 0,
          message: 'Failed to parse JSON',
          errors: [(error as Error).message],
        },
      })
    }
  }

  return results
}

/**
 * Check if batch response item contains an error
 * @param response - Batch response item
 * @returns True if response is an error object
 */
function isBatchError(response: any): boolean {
  return response && typeof response === 'object' && 'error' in response
}

/**
 * Parse a single Gmail message using the gmail-api-parse-message library
 * @param message - Raw Gmail message with payload
 * @returns Parsed Gmail message
 */
function parseGmailMessage(message: GmailMessageWithPayload): ParsedGmailMessage {
  try {
    // The library expects the raw message object from the API
    return parse(message) as ParsedGmailMessage
  } catch (error) {
    logger.error("Error parsing message with 'gmail-api-parse-message'", {
      error,
      messageId: message.id,
    })
    // Return a placeholder structure on error
    return {
      id: message.id,
      threadId: message.threadId,
      labelIds: message.labelIds || [],
      snippet: 'Error parsing message',
      historyId: message.historyId || '0',
      internalDate: message.internalDate || '0',
      attachments: [],
      headers: {},
      textPlain: 'Error parsing content.',
      textHtml: '<p>Error.</p>',
    }
  }
}
