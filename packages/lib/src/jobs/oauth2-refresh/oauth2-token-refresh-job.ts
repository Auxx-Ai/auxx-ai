// packages/lib/src/jobs/oauth2-refresh/oauth2-token-refresh-job.ts

import { createScopedLogger } from '@auxx/logger'
import type { Job } from 'bullmq'
import { refreshCredentialTokens } from '../../connections/oauth2-token-grants'

const logger = createScopedLogger('oauth2-token-refresh-job')

/** Individual refresh job payload. Routing now derives from the credential record itself. */
interface OAuth2TokenRefreshJobData {
  credentialId: string
  organizationId: string
  previousFailureCount?: number
  attemptNumber?: number
}

/**
 * OAuth2 Token Refresh Job
 *
 * Refreshes a single OAuth2 connection's access token via the credential store.
 * `refreshCredentialTokens` handles routing (by kind), secret rotation, and the circuit breaker.
 *
 * On success: resets the breaker, stamps lastRefreshAt, updates expiresAt.
 * On failure: increments the breaker (a permanent failure opens it immediately) and throws so
 * BullMQ retries with backoff.
 */
export const oauth2TokenRefreshJob = async (job: Job<OAuth2TokenRefreshJobData>) => {
  const { credentialId, organizationId, previousFailureCount = 0, attemptNumber = 1 } = job.data

  logger.info('Starting OAuth2 token refresh', {
    credentialId,
    previousFailureCount,
    attemptNumber,
  })

  await job.updateProgress(30)

  const result = await refreshCredentialTokens(credentialId, organizationId)

  await job.updateProgress(100)

  if (result.success) {
    logger.info('OAuth2 token refresh succeeded', {
      credentialId,
      expiresAt: result.expiresAt,
      circuitBreakerReset: previousFailureCount > 0,
    })
    return { success: true, credentialId, expiresAt: result.expiresAt }
  }

  logger.error('OAuth2 token refresh failed', {
    credentialId,
    error: result.error,
    consecutiveFailures: result.newFailureCount,
    circuitOpened: result.circuitOpened,
  })
  throw new Error(result.error)
}
