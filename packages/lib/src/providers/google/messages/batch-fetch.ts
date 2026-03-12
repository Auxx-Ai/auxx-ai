// packages/lib/src/providers/google/messages/batch-fetch.ts

import { createScopedLogger } from '@auxx/logger'
import { generateMimeBoundary } from '@auxx/utils'
import parse from 'gmail-api-parse-message'
import { getGmailQuotaCost, type UniversalThrottler } from '../../../utils/rate-limiter'
import { handleGmailError } from '../shared/error-handler'
import { executeWithThrottle } from '../shared/utils'
import type { GmailMessageWithPayload, ParsedGmailMessage } from '../types'

const logger = createScopedLogger('google-batch-fetch')

const BATCH_LIMIT = 20 // Max messages per batch request (reduced from 50 to avoid per-item 429s)
const RETRY_BATCH_LIMIT = 5 // Smaller batch size for retry attempts
const MAX_ITEM_RETRIES = 2 // Max retry rounds for item-level 429 failures
const INTER_BATCH_DELAY_MS = 500 // Delay between batches
const RETRY_BASE_DELAY_MS = 1000 // Base delay for retry backoff
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
 * Result of batch fetching Gmail messages.
 * Contains both parsed messages (for headers, body) and raw messages (for attachment extraction).
 * Also surfaces IDs that could not be fetched after retries.
 */
export interface BatchFetchResult {
  parsed: ParsedGmailMessage[]
  raw: GmailMessageWithPayload[]
  failedMessageIds: string[]
}

/**
 * Fetches multiple Gmail messages in batches using Gmail batch API.
 * Item-level 429 errors are retried with exponential backoff and smaller batches.
 */
export async function getMessagesBatch(input: GetMessagesBatchInput): Promise<BatchFetchResult> {
  const { messageIds, integrationId, throttler, accessToken } = input

  if (messageIds.length === 0) return { parsed: [], raw: [], failedMessageIds: [] }

  logger.info('Starting batch fetch', {
    totalMessages: messageIds.length,
    batchSize: BATCH_LIMIT,
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
  const allRawMessages: GmailMessageWithPayload[] = []
  const allFailedIds: string[] = []
  const totalBatches = Math.ceil(limitedMessageIds.length / BATCH_LIMIT)

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
      const { parsed, raw, failedIds } = await fetchBatchWithRetry({
        ids: batchIds,
        accessToken,
        integrationId,
        throttler,
        batchNumber,
        totalBatches,
      })

      allMessages.push(...parsed)
      allRawMessages.push(...raw)
      allFailedIds.push(...failedIds)

      logger.info('Batch parsed', {
        batchNumber,
        totalBatches,
        messagesParsed: parsed.length,
        failedInBatch: failedIds.length,
        totalSoFar: allMessages.length,
        integrationId,
      })

      // Add delay between batches (except for the last batch)
      if (batchNumber < totalBatches) {
        await new Promise((resolve) => setTimeout(resolve, INTER_BATCH_DELAY_MS))
      }
    } catch (error: any) {
      const isTimeout = error?.message?.includes('timed out')
      if (isTimeout) {
        logger.error('Batch fetch timed out', {
          error: error.message,
          batchNumber,
          totalBatches,
          messagesProcessed: allMessages.length,
          integrationId,
        })
        allFailedIds.push(...batchIds)
        continue
      }

      const isRateLimit =
        error?.message?.includes('429') ||
        error?.message?.includes('rateLimitExceeded') ||
        error?.message?.includes('Too many concurrent requests')

      if (isRateLimit) {
        logger.error('Rate limit hit during batch fetch, stopping remaining batches', {
          error: error.message,
          batchNumber,
          totalBatches,
          messagesProcessed: allMessages.length,
          integrationId,
        })
        // Mark all remaining IDs as failed
        allFailedIds.push(...limitedMessageIds.slice(i))
        break
      }

      logger.error('Batch fetch failed', {
        error: error.message || error,
        batchNumber,
        totalBatches,
        integrationId,
      })
      allFailedIds.push(...batchIds)
    }
  }

  logger.info('Batch fetch completed', {
    totalRequested: limitedMessageIds.length,
    totalFetched: allMessages.length,
    totalFailed: allFailedIds.length,
    integrationId,
  })

  return { parsed: allMessages, raw: allRawMessages, failedMessageIds: allFailedIds }
}

/**
 * Fetch a single batch of IDs, retrying item-level 429s with smaller sub-batches.
 */
async function fetchBatchWithRetry(opts: {
  ids: string[]
  accessToken: string
  integrationId: string
  throttler: UniversalThrottler
  batchNumber: number
  totalBatches: number
}): Promise<{ parsed: ParsedGmailMessage[]; raw: GmailMessageWithPayload[]; failedIds: string[] }> {
  const { accessToken, integrationId, throttler, batchNumber, totalBatches } = opts

  let pendingIds = [...opts.ids]
  const parsed: ParsedGmailMessage[] = []
  const raw: GmailMessageWithPayload[] = []
  let currentBatchSize = Math.min(pendingIds.length, BATCH_LIMIT)

  for (let attempt = 0; attempt <= MAX_ITEM_RETRIES && pendingIds.length > 0; attempt++) {
    const batchLabel = `Batch ${batchNumber}/${totalBatches}${attempt > 0 ? ` retry-${attempt}` : ''}`

    const batchResponses = await withTimeout(
      executeBatchRequest(
        pendingIds.slice(0, currentBatchSize),
        '/gmail/v1/users/me/messages',
        accessToken,
        integrationId,
        throttler
      ),
      BATCH_REQUEST_TIMEOUT_MS,
      batchLabel
    )

    const rateLimitedIds: string[] = []
    const requestedIds = pendingIds.slice(0, currentBatchSize)

    for (let i = 0; i < batchResponses.length; i++) {
      const response = batchResponses[i]
      const messageId = requestedIds[i]

      if (isBatchItemRateLimited(response)) {
        if (messageId) rateLimitedIds.push(messageId)
        logger.warn('Batch item rate-limited', {
          messageId,
          batchNumber,
          attempt,
          reason: response?.error?.message,
          integrationId,
        })
        continue
      }

      if (isBatchError(response)) {
        logger.warn('Batch item error (non-retriable)', {
          messageId,
          error: response.error,
          integrationId,
        })
        continue
      }

      if (
        response &&
        typeof response === 'object' &&
        response.id &&
        response.threadId &&
        response.payload
      ) {
        const rawMsg = response as GmailMessageWithPayload
        raw.push(rawMsg)
        parsed.push(parseGmailMessage(rawMsg))
      }
    }

    // Remove successfully fetched IDs from pending
    const fetchedIdSet = new Set(parsed.map((m) => m.id))
    pendingIds = pendingIds.filter((id) => !fetchedIdSet.has(id))

    if (rateLimitedIds.length === 0 || attempt === MAX_ITEM_RETRIES) break

    // Retry rate-limited IDs with smaller batch + backoff
    pendingIds = rateLimitedIds
    currentBatchSize = RETRY_BATCH_LIMIT
    const delay = RETRY_BASE_DELAY_MS * 2 ** attempt
    logger.info('Retrying rate-limited message IDs', {
      count: rateLimitedIds.length,
      attempt: attempt + 1,
      delayMs: delay,
      batchSize: currentBatchSize,
      integrationId,
    })
    await new Promise((resolve) => setTimeout(resolve, delay))
  }

  return { parsed, raw, failedIds: pendingIds }
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
 */
function isBatchError(response: any): boolean {
  return response && typeof response === 'object' && 'error' in response
}

/**
 * Check if a batch item error is a rate-limit (429 / RESOURCE_EXHAUSTED).
 */
function isBatchItemRateLimited(response: any): boolean {
  if (!isBatchError(response)) return false
  const code = response.error?.code
  if (code === 429) return true
  const reason = response.error?.errors?.[0]?.reason
  if (reason === 'rateLimitExceeded' || reason === 'RESOURCE_EXHAUSTED') return true
  const message = response.error?.message ?? ''
  if (message.includes('Too many concurrent requests')) return true
  return false
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
