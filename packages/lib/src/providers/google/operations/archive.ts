// packages/lib/src/providers/google/operations/archive.ts

import { createScopedLogger } from '@auxx/logger'
import type { gmail_v1 } from 'googleapis'
import type { UniversalThrottler } from '../../../utils/rate-limiter'
import { modifyWithThrottling } from '../shared/utils'

const logger = createScopedLogger('google-archive')

/**
 * Archive a Gmail message or thread by removing the INBOX label
 */
export async function archive(
  gmail: gmail_v1.Gmail,
  externalId: string,
  type: 'message' | 'thread',
  integrationId: string,
  throttler: UniversalThrottler
): Promise<boolean> {
  logger.info(`Archiving Gmail ${type}: ${externalId}`)
  try {
    // Archiving in Gmail means removing the INBOX label
    await modifyWithThrottling(
      gmail,
      type,
      externalId,
      { removeLabelIds: ['INBOX'] },
      integrationId,
      throttler
    )
    logger.info(`Gmail ${type} ${externalId} archived.`)
    return true
  } catch (error: any) {
    logger.error(`Failed to archive Gmail ${type} ${externalId}`, {
      error: error.message,
      status: error.response?.status,
    })
    return false
  }
}
