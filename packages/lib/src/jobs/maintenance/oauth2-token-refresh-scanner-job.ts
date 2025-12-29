// packages/lib/src/jobs/maintenance/oauth2-token-refresh-scanner-job.ts

import type { Job } from 'bullmq'
import { createScopedLogger } from '@auxx/logger'
import { database as db, schema } from '@auxx/database'
import { eq, and, isNotNull, or, lt, sql } from 'drizzle-orm'
import { getQueue, Queues } from '../queues'
import { CredentialService } from '@auxx/credentials'

const logger = createScopedLogger('oauth2-token-refresh-scanner-job')

/** Scanner job payload schema */
interface OAuth2TokenRefreshScannerJobData {
  dryRun?: boolean
  batchSize?: number
}

/** Scanner statistics */
interface ScannerStats {
  connectionsScanned: number
  refreshJobsEnqueued: number
  skippedCircuitBreaker: number
  skippedNotDue: number
  skippedNoRefreshToken: number
  errors: number
}

/**
 * OAuth2 Token Refresh Scanner Job
 *
 * Finds OAuth2 connections that need token refresh and enqueues individual refresh jobs.
 * Runs every 15 minutes to proactively refresh tokens before expiration.
 *
 * IMPORTANT: OAuth2 providers require the 'offline_access' (Google, Microsoft) or 'offline'
 * scope to issue refresh tokens. Credentials created without this scope cannot be
 * automatically refreshed and will be skipped by this scanner.
 *
 * Strategy:
 * - Query ConnectionDefinitions with oauth2RefreshTokenIntervalSeconds set
 * - Find active WorkflowCredentials (app-connections) for each definition
 * - Validate credentials have refresh tokens (decrypt and check)
 * - Check circuit breaker state (skip if open)
 * - Calculate if refresh is due based on schedule or expiration
 * - Enqueue individual refresh jobs to oauth2RefreshQueue
 */
export const oauth2TokenRefreshScannerJob = async (
  job: Job<OAuth2TokenRefreshScannerJobData>
) => {
  const { dryRun = false, batchSize = 50 } = job.data

  logger.info('Starting OAuth2 token refresh scanner', {
    dryRun,
    batchSize,
    jobId: job.id,
  })

  const stats: ScannerStats = {
    connectionsScanned: 0,
    refreshJobsEnqueued: 0,
    skippedCircuitBreaker: 0,
    skippedNotDue: 0,
    skippedNoRefreshToken: 0,
    errors: 0,
  }

  try {
    await job.updateProgress(10)

    const now = new Date()
    const oauth2RefreshQueue = getQueue(Queues.oauth2RefreshQueue)

    // Query ConnectionDefinitions that have oauth2RefreshTokenIntervalSeconds configured
    const connectionDefinitions = await db.query.ConnectionDefinition.findMany({
      columns: {
        id: true,
        appId: true,
        oauth2RefreshTokenIntervalSeconds: true,
      },
      where: isNotNull(schema.ConnectionDefinition.oauth2RefreshTokenIntervalSeconds),
    })

    logger.info('Found connection definitions with OAuth2 refresh', {
      count: connectionDefinitions.length,
    })

    await job.updateProgress(30)

    // For each definition, find active WorkflowCredentials
    for (const definition of connectionDefinitions) {
      try {
        // Get all active app-connection credentials for this app
        const credentials = await db.query.WorkflowCredentials.findMany({
          columns: {
            id: true,
            organizationId: true,
            appId: true,
            type: true,
            expiresAt: true,
            lastTokenRefreshAt: true,
            lastRefreshFailureAt: true,
            consecutiveRefreshFailures: true,
            createdAt: true,
            encryptedData: true,
          },
          where: and(
            eq(schema.WorkflowCredentials.appId, definition.appId),
            eq(schema.WorkflowCredentials.type, 'app-connection')
          ),
        })

        for (const credential of credentials) {
          stats.connectionsScanned++

          // Validate credential has refresh token
          try {
            const decryptedData = CredentialService.decrypt(credential.encryptedData)
            const hasRefreshToken = 'refreshToken' in decryptedData && !!decryptedData.refreshToken

            if (!hasRefreshToken) {
              stats.skippedNoRefreshToken++
              logger.debug('Skipping credential - no refresh token available', {
                credentialId: credential.id,
                organizationId: credential.organizationId,
                note: 'OAuth2 requires offline_access or offline scope for refresh tokens',
              })
              continue
            }
          } catch (error) {
            stats.errors++
            logger.error('Error decrypting credential', {
              credentialId: credential.id,
              error: error instanceof Error ? error.message : String(error),
            })
            continue
          }

          // Circuit breaker check: Skip if circuit is open
          const isCircuitOpen =
            credential.consecutiveRefreshFailures >= 5 &&
            credential.lastRefreshFailureAt &&
            now.getTime() - credential.lastRefreshFailureAt.getTime() < 24 * 60 * 60 * 1000 // 24 hours

          if (isCircuitOpen) {
            stats.skippedCircuitBreaker++
            logger.debug('Skipping credential due to open circuit breaker', {
              credentialId: credential.id,
              consecutiveFailures: credential.consecutiveRefreshFailures,
              lastFailure: credential.lastRefreshFailureAt,
            })
            continue
          }

          // Check if refresh is due
          const refreshIntervalSeconds = definition.oauth2RefreshTokenIntervalSeconds!
          const refreshIntervalMs = refreshIntervalSeconds * 1000

          // Strategy A: Time-based (use refresh schedule with 90% threshold)
          const lastRefresh = credential.lastTokenRefreshAt || credential.createdAt
          const timeSinceLastRefresh = now.getTime() - lastRefresh.getTime()
          const shouldRefreshBySchedule = timeSinceLastRefresh >= refreshIntervalMs * 0.9

          // Strategy B: Expiration-based (refresh when close to expiry with 10% buffer)
          let shouldRefreshByExpiry = false
          if (credential.expiresAt) {
            const timeUntilExpiry = credential.expiresAt.getTime() - now.getTime()
            shouldRefreshByExpiry = timeUntilExpiry <= refreshIntervalMs * 0.1
          }

          const shouldRefresh = shouldRefreshBySchedule || shouldRefreshByExpiry

          if (!shouldRefresh) {
            stats.skippedNotDue++
            logger.debug('Skipping credential - refresh not due yet', {
              credentialId: credential.id,
              lastRefresh,
              timeSinceLastRefresh: Math.round(timeSinceLastRefresh / 1000),
              refreshIntervalSeconds,
              expiresAt: credential.expiresAt,
            })
            continue
          }

          // Enqueue refresh job
          if (!dryRun) {
            await oauth2RefreshQueue.add(
              'oauth2TokenRefreshJob',
              {
                credentialId: credential.id,
                appId: credential.appId,
                organizationId: credential.organizationId,
                credentialType: credential.type,
                previousFailureCount: credential.consecutiveRefreshFailures,
                attemptNumber: 1,
              },
              {
                jobId: `oauth2-refresh-${credential.id}-${now.getTime()}`,
                attempts: 3,
                backoff: { type: 'exponential', delay: 60000 }, // 1min, 2min, 4min
                removeOnComplete: { count: 100 },
                removeOnFail: { count: 500 },
              }
            )
            stats.refreshJobsEnqueued++

            logger.debug('Enqueued refresh job', {
              credentialId: credential.id,
              organizationId: credential.organizationId,
              reason: shouldRefreshBySchedule ? 'schedule' : 'expiry',
            })
          } else {
            stats.refreshJobsEnqueued++
            logger.info('Would enqueue refresh job (dry run)', {
              credentialId: credential.id,
              organizationId: credential.organizationId,
              reason: shouldRefreshBySchedule ? 'schedule' : 'expiry',
            })
          }
        }
      } catch (error) {
        stats.errors++
        logger.error('Error processing connection definition', {
          definitionId: definition.id,
          appId: definition.appId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    await job.updateProgress(100)

    logger.info('OAuth2 token refresh scanner completed', {
      stats,
      dryRun,
      jobId: job.id,
    })

    return {
      success: true,
      stats,
      dryRun,
    }
  } catch (error) {
    logger.error('OAuth2 token refresh scanner failed', {
      error: error instanceof Error ? error.message : String(error),
      stats,
      jobId: job.id,
    })

    throw error
  }
}
