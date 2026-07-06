// packages/lib/src/jobs/maintenance/oauth2-token-refresh-scanner-job.ts

import { revealSecrets } from '@auxx/credentials/store'
import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray, isNotNull, lte } from 'drizzle-orm'
import { getQueue, Queues } from '../queues'
import type { JobContext } from '../types'

const logger = createScopedLogger('oauth2-token-refresh-scanner-job')

/**
 * Proactive-refresh buffer for `kind:'connection'` credentials scanned by expiry (channels +
 * any platform provider whose def sets no oauth2RefreshTokenIntervalSeconds — e.g. the mail defs
 * gmail/outlookMail). Mirrors the old channel-token-refresh-scanner's 30-min window so the
 * Gmail watch / Graph subscription ingestion path always has a warm token (§8). Rows with no
 * `expiresAt` (e.g. AI API keys) never match.
 */
const CONNECTION_REFRESH_BUFFER_MS = 30 * 60 * 1000

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
 * - Batch-load their Credentials (two inArray queries: app-owned, mcp-owned)
 * - Check circuit breaker state (skip if open) — plain columns
 * - Calculate if refresh is due based on schedule or expiration — plain columns
 * - Only for due credentials: decrypt and validate a refresh token exists
 * - Enqueue individual refresh jobs to oauth2RefreshQueue
 */
export const oauth2TokenRefreshScannerJob = async (
  ctx: JobContext<OAuth2TokenRefreshScannerJobData>
) => {
  const job = ctx.job
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
        mcpServerId: true,
        oauth2RefreshTokenIntervalSeconds: true,
      },
      where: isNotNull(schema.ConnectionDefinition.oauth2RefreshTokenIntervalSeconds),
    })

    logger.info('Found connection definitions with OAuth2 refresh', {
      count: connectionDefinitions.length,
    })

    await job.updateProgress(30)

    // Batch-load credentials for all definitions up front (was one query per definition).
    // MCP definitions own their credentials via mcpServerId + kind 'mcp';
    // app definitions via appId + kind 'app'.
    const credentialColumns = {
      id: true,
      organizationId: true,
      appId: true,
      mcpServerId: true,
      expiresAt: true,
      lastRefreshAt: true,
      lastRefreshFailureAt: true,
      consecutiveRefreshFailures: true,
      createdAt: true,
    } as const
    const appIds = [
      ...new Set(
        connectionDefinitions.filter((d) => !d.mcpServerId && d.appId).map((d) => d.appId!)
      ),
    ]
    const mcpServerIds = [
      ...new Set(connectionDefinitions.filter((d) => d.mcpServerId).map((d) => d.mcpServerId!)),
    ]
    const [appCredentials, mcpCredentials] = await Promise.all([
      appIds.length
        ? db.query.Credential.findMany({
            columns: credentialColumns,
            where: and(eq(schema.Credential.kind, 'app'), inArray(schema.Credential.appId, appIds)),
          })
        : [],
      mcpServerIds.length
        ? db.query.Credential.findMany({
            columns: credentialColumns,
            where: and(
              eq(schema.Credential.kind, 'mcp'),
              inArray(schema.Credential.mcpServerId, mcpServerIds)
            ),
          })
        : [],
    ])
    const credentialsByAppId = new Map<string, typeof appCredentials>()
    for (const credential of appCredentials) {
      if (!credential.appId) continue
      const group = credentialsByAppId.get(credential.appId) ?? []
      group.push(credential)
      credentialsByAppId.set(credential.appId, group)
    }
    const credentialsByMcpServerId = new Map<string, typeof mcpCredentials>()
    for (const credential of mcpCredentials) {
      if (!credential.mcpServerId) continue
      const group = credentialsByMcpServerId.get(credential.mcpServerId) ?? []
      group.push(credential)
      credentialsByMcpServerId.set(credential.mcpServerId, group)
    }

    for (const definition of connectionDefinitions) {
      try {
        const credentials = definition.mcpServerId
          ? (credentialsByMcpServerId.get(definition.mcpServerId) ?? [])
          : definition.appId
            ? (credentialsByAppId.get(definition.appId) ?? [])
            : []

        for (const credential of credentials) {
          stats.connectionsScanned++

          // Circuit breaker check: Skip if circuit is open (plain columns — no decrypt)
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

          // Check if refresh is due (plain columns — expiresAt is the only home of expiry)
          const refreshIntervalSeconds = definition.oauth2RefreshTokenIntervalSeconds!
          const refreshIntervalMs = refreshIntervalSeconds * 1000

          // Strategy A: Time-based (use refresh schedule with 90% threshold)
          const lastRefresh = credential.lastRefreshAt || credential.createdAt
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

          // Only now decrypt: validate the due credential has a refresh token.
          const revealed = await revealSecrets<{ refreshToken?: string }>(
            credential.id,
            credential.organizationId
          )
          if (revealed.isErr()) {
            stats.errors++
            logger.error('Error revealing credential', {
              credentialId: credential.id,
              error: revealed.error.message,
            })
            continue
          }
          if (!revealed.value.secrets.refreshToken) {
            stats.skippedNoRefreshToken++
            logger.debug('Skipping credential - no refresh token available', {
              credentialId: credential.id,
              organizationId: credential.organizationId,
              note: 'OAuth2 requires offline_access or offline scope for refresh tokens',
            })
            continue
          }

          // Enqueue refresh job
          if (!dryRun) {
            await oauth2RefreshQueue.add(
              'oauth2TokenRefreshJob',
              {
                credentialId: credential.id,
                organizationId: credential.organizationId,
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
          mcpServerId: definition.mcpServerId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    // Connection credentials scanned by expiry directly (no def interval): channels + any
    // platform provider whose def sets no refresh interval. Only those linked to a
    // ConnectionDefinition resolve a refresh; unlinked legacy rows are covered by the SDK-side
    // path until they're reconnected (§9.1).
    await job.updateProgress(80)
    const connectionCutoff = new Date(now.getTime() + CONNECTION_REFRESH_BUFFER_MS)
    const connectionCredentials = await db.query.Credential.findMany({
      columns: {
        id: true,
        organizationId: true,
        expiresAt: true,
        lastRefreshFailureAt: true,
        consecutiveRefreshFailures: true,
      },
      where: and(
        eq(schema.Credential.kind, 'connection'),
        isNotNull(schema.Credential.connectionDefinitionId),
        isNotNull(schema.Credential.expiresAt),
        lte(schema.Credential.expiresAt, connectionCutoff)
      ),
      limit: batchSize,
    })

    for (const credential of connectionCredentials) {
      try {
        stats.connectionsScanned++

        const isCircuitOpen =
          credential.consecutiveRefreshFailures >= 5 &&
          credential.lastRefreshFailureAt &&
          now.getTime() - credential.lastRefreshFailureAt.getTime() < 24 * 60 * 60 * 1000
        if (isCircuitOpen) {
          stats.skippedCircuitBreaker++
          continue
        }

        const revealed = await revealSecrets<{ refreshToken?: string }>(
          credential.id,
          credential.organizationId
        )
        if (revealed.isErr()) {
          stats.errors++
          continue
        }
        if (!revealed.value.secrets.refreshToken) {
          stats.skippedNoRefreshToken++
          continue
        }

        if (!dryRun) {
          await oauth2RefreshQueue.add(
            'oauth2TokenRefreshJob',
            {
              credentialId: credential.id,
              organizationId: credential.organizationId,
              previousFailureCount: credential.consecutiveRefreshFailures,
              attemptNumber: 1,
            },
            {
              jobId: `oauth2-refresh-${credential.id}-${now.getTime()}`,
              attempts: 3,
              backoff: { type: 'exponential', delay: 60000 },
              removeOnComplete: { count: 100 },
              removeOnFail: { count: 500 },
            }
          )
        }
        stats.refreshJobsEnqueued++
      } catch (error) {
        stats.errors++
        logger.error('Error processing integration credential', {
          credentialId: credential.id,
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
