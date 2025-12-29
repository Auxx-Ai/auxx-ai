// packages/lib/src/jobs/oauth2-refresh/oauth2-token-refresh-job.ts

import type { Job } from 'bullmq'
import { createScopedLogger } from '@auxx/logger'
import { OAuth2WorkflowService } from '../../workflows/oauth2-workflow.service'

const logger = createScopedLogger('oauth2-token-refresh-job')

/** Individual refresh job payload */
interface OAuth2TokenRefreshJobData {
  credentialId: string
  appId: string
  organizationId: string
  credentialType: string
  previousFailureCount: number
  attemptNumber?: number
}

/**
 * OAuth2 Token Refresh Job
 *
 * Refreshes a single OAuth2 connection's access token.
 * Handles success/failure states and updates circuit breaker fields.
 *
 * On success:
 * - Updates lastTokenRefreshAt to current time
 * - Updates expiresAt from new token data
 * - Resets consecutiveRefreshFailures to 0
 * - Clears lastRefreshFailureAt
 *
 * On failure:
 * - Increments consecutiveRefreshFailures
 * - Updates lastRefreshFailureAt to current time
 * - Circuit breaker opens after 5 consecutive failures
 */
export const oauth2TokenRefreshJob = async (job: Job<OAuth2TokenRefreshJobData>) => {
  const {
    credentialId,
    appId,
    organizationId,
    credentialType,
    previousFailureCount,
    attemptNumber = 1,
  } = job.data

  logger.info('Starting OAuth2 token refresh', {
    credentialId,
    credentialType,
    previousFailureCount,
    attemptNumber,
  })

  try {
    await job.updateProgress(30)

    // Call OAuth service - it handles EVERYTHING (queries, updates, circuit breaker)
    const oauth2Service = OAuth2WorkflowService.getInstance()

    const result = await oauth2Service.refreshTokensWithMetadata({
      credentialId,
      organizationId,
      appId,
      credentialType,
      previousFailureCount,
    })

    await job.updateProgress(100)

    if (result.success) {
      logger.info('OAuth2 token refresh succeeded', {
        credentialId,
        expiresAt: result.expiresAt,
        circuitBreakerReset: previousFailureCount > 0,
      })

      return {
        success: true,
        credentialId,
        expiresAt: result.expiresAt,
      }
    } else {
      logger.error('OAuth2 token refresh failed', {
        credentialId,
        error: result.error,
        consecutiveFailures: result.newFailureCount,
        circuitOpened: result.circuitOpened,
      })

      throw new Error(result.error)
    }
  } catch (error) {
    logger.error('OAuth2 token refresh job error', {
      credentialId,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}
