// packages/lib/src/providers/google/threads/get-thread.ts

import { createScopedLogger } from '@auxx/logger'
import type { gmail_v1 } from 'googleapis'
import { getGmailQuotaCost, type UniversalThrottler } from '../../../utils/rate-limiter'
import { handleGmailError } from '../shared/error-handler'
import { executeWithThrottle } from '../shared/utils'

const logger = createScopedLogger('google-threads:get')

/**
 * Options for getting a thread
 */
export interface GetThreadOptions {
  gmail: gmail_v1.Gmail
  externalThreadId: string
  integrationId: string
  throttler: UniversalThrottler
  threadId?: string
}

/**
 * Get a Gmail thread by ID
 */
export async function getThread(options: GetThreadOptions): Promise<gmail_v1.Schema$Thread> {
  const { gmail, externalThreadId, integrationId, throttler } = options

  logger.info(`Getting Gmail thread: ${externalThreadId}`)

  try {
    const response = await executeWithThrottle(
      'gmail.threads.get',
      async () =>
        gmail.users.threads.get({
          userId: 'me',
          id: externalThreadId,
          format: 'metadata', // Fetch metadata initially, get full messages if needed
        }),
      {
        userId: integrationId,
        throttler,
        cost: getGmailQuotaCost('threads.get'), // 10 quota units
        queue: true,
        priority: 5, // Medium priority
      }
    )

    return response.data
  } catch (error: any) {
    logger.error(`Failed to get Gmail thread ${externalThreadId}`, {
      error: error.message,
      status: error.response?.status,
    })
    throw await handleGmailError(error, 'threads.get', integrationId)
  }
}
