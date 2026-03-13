// packages/lib/src/jobs/maintenance/integration-token-refresh-scanner-job.ts

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { Job } from 'bullmq'
import { and, eq, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm'
import { resolveEffectiveSyncMode } from '../../providers/sync-mode-resolver'
import { getQueue, Queues } from '../queues'

const logger = createScopedLogger('integration-token-refresh-scanner')

/** Scanner job payload */
export interface IntegrationTokenRefreshScannerJobData {
  dryRun?: boolean
}

/** Scanner statistics */
interface ScannerStats {
  integrationsScanned: number
  refreshJobsEnqueued: number
  watchRenewalJobsEnqueued: number
  skippedNoRefreshToken: number
  skippedAuthError: number
  alreadyQueued: number
  errors: number
}

/** Integration metadata structure for type safety */
interface IntegrationMetadata {
  watchExpiration?: number | string
  subscriptionExpiration?: number | string
  [key: string]: unknown
}

// Refresh tokens 30 minutes before access token expires
const TOKEN_REFRESH_BUFFER_MS = 30 * 60 * 1000

// Renew Gmail watch 1 day before expiration (watch lasts 7 days)
const GMAIL_WATCH_RENEWAL_BUFFER_MS = 24 * 60 * 60 * 1000

// Renew Outlook subscription 1 day before expiration (subscription lasts ~3 days)
const OUTLOOK_SUBSCRIPTION_RENEWAL_BUFFER_MS = 24 * 60 * 60 * 1000

// Supported OAuth providers
const OAUTH_PROVIDERS = ['google', 'outlook'] as const

// Auth statuses that require user re-authentication
const UNRECOVERABLE_AUTH_STATUSES = ['INVALID_GRANT', 'REVOKED_ACCESS', 'INSUFFICIENT_SCOPE']

/**
 * Integration Token Refresh Scanner Job:
 *
 * Scans enabled email integrations and enqueues refresh jobs for:
 * 1. Access tokens nearing expiration
 * 2. Gmail watches nearing expiration
 * 3. Outlook subscriptions nearing expiration
 *
 * Runs every 15 minutes via cron.
 */
export const integrationTokenRefreshScannerJob = async (
  job: Job<IntegrationTokenRefreshScannerJobData>
) => {
  const { dryRun = false } = job.data

  logger.info('Starting integration token refresh scanner', {
    dryRun,
    jobId: job.id,
  })

  const stats: ScannerStats = {
    integrationsScanned: 0,
    refreshJobsEnqueued: 0,
    watchRenewalJobsEnqueued: 0,
    skippedNoRefreshToken: 0,
    skippedAuthError: 0,
    alreadyQueued: 0,
    errors: 0,
  }

  try {
    await job.updateProgress(10)
    const now = new Date()
    const maintenanceQueue = getQueue(Queues.maintenanceQueue)

    // Calculate thresholds
    const tokenRefreshThreshold = new Date(now.getTime() + TOKEN_REFRESH_BUFFER_MS)

    // Query enabled integrations with tokens expiring soon
    // This is more efficient than fetching all and filtering in memory
    const integrations = await db
      .select({
        id: schema.Integration.id,
        organizationId: schema.Integration.organizationId,
        provider: schema.Integration.provider,
        syncMode: schema.Integration.syncMode,
        credentialId: schema.Integration.credentialId,
        expiresAt: schema.Integration.expiresAt,
        authStatus: schema.Integration.authStatus,
        metadata: schema.Integration.metadata,
        enabled: schema.Integration.enabled,
      })
      .from(schema.Integration)
      .where(
        and(
          inArray(schema.Integration.provider, [...OAUTH_PROVIDERS]),
          isNotNull(schema.Integration.credentialId),
          eq(schema.Integration.enabled, true),
          isNull(schema.Integration.deletedAt),
          // Token expires within buffer period OR no expiration set (needs refresh)
          or(
            lt(schema.Integration.expiresAt, tokenRefreshThreshold),
            sql`${schema.Integration.expiresAt} IS NULL`
          )
        )
      )

    logger.info('Found integrations needing token refresh', {
      count: integrations.length,
    })

    await job.updateProgress(30)

    // Also query integrations that might need watch/subscription renewal
    // These may have valid tokens but expiring webhooks
    const integrationsForWebhookCheck = await db
      .select({
        id: schema.Integration.id,
        organizationId: schema.Integration.organizationId,
        provider: schema.Integration.provider,
        syncMode: schema.Integration.syncMode,
        credentialId: schema.Integration.credentialId,
        expiresAt: schema.Integration.expiresAt,
        authStatus: schema.Integration.authStatus,
        metadata: schema.Integration.metadata,
        enabled: schema.Integration.enabled,
      })
      .from(schema.Integration)
      .where(
        and(
          inArray(schema.Integration.provider, [...OAUTH_PROVIDERS]),
          isNotNull(schema.Integration.credentialId),
          eq(schema.Integration.enabled, true),
          isNull(schema.Integration.deletedAt)
        )
      )

    // Combine and deduplicate
    const allIntegrationIds = new Set<string>()
    const allIntegrations = [...integrations]

    // Add IDs from first query
    for (const integration of integrations) {
      allIntegrationIds.add(integration.id)
    }

    for (const integration of integrationsForWebhookCheck) {
      if (!allIntegrationIds.has(integration.id)) {
        // Check if webhook renewal is needed
        const metadata = integration.metadata as IntegrationMetadata | null
        const needsWebhookRenewal = checkWebhookRenewalNeeded(
          integration.provider as 'google' | 'outlook',
          metadata,
          now
        )
        if (needsWebhookRenewal) {
          allIntegrations.push(integration)
          allIntegrationIds.add(integration.id)
        }
      }
    }

    await job.updateProgress(50)

    for (const integration of allIntegrations) {
      stats.integrationsScanned++

      try {
        // Skip integrations without linked credentials
        if (!integration.credentialId) {
          stats.skippedNoRefreshToken++
          continue
        }

        // Skip integrations with unrecoverable auth errors (user needs to re-authenticate)
        if (UNRECOVERABLE_AUTH_STATUSES.includes(integration.authStatus ?? '')) {
          stats.skippedAuthError++
          logger.debug('Skipping integration with auth error', {
            integrationId: integration.id,
            authStatus: integration.authStatus,
          })
          continue
        }

        const metadata = integration.metadata as IntegrationMetadata | null

        // Check if token refresh is needed
        let shouldRefreshToken = false
        if (integration.expiresAt) {
          const timeUntilExpiry = integration.expiresAt.getTime() - now.getTime()
          shouldRefreshToken = timeUntilExpiry <= TOKEN_REFRESH_BUFFER_MS
        } else {
          // No expiration set - refresh to get a valid token
          shouldRefreshToken = true
        }

        // Check if webhook renewal is needed (skip for polling-mode integrations)
        const effectiveMode = resolveEffectiveSyncMode({
          syncMode: integration.syncMode,
          provider: integration.provider,
        })
        const shouldRenewWebhook =
          effectiveMode === 'webhook' &&
          checkWebhookRenewalNeeded(integration.provider as 'google' | 'outlook', metadata, now)

        if (!shouldRefreshToken && !shouldRenewWebhook) {
          continue
        }

        // Use stable job ID to prevent duplicate jobs for same integration
        const jobId = `integration-refresh-${integration.id}`

        // Enqueue refresh job
        if (!dryRun) {
          try {
            await maintenanceQueue.add(
              'integrationTokenRefreshJob',
              {
                integrationId: integration.id,
                organizationId: integration.organizationId,
                provider: integration.provider,
                refreshToken: shouldRefreshToken,
                renewWebhook: shouldRenewWebhook,
              },
              {
                jobId,
                attempts: 3,
                backoff: { type: 'exponential', delay: 60000 },
                removeOnComplete: { count: 100 },
                removeOnFail: { count: 500 },
              }
            )

            if (shouldRefreshToken) stats.refreshJobsEnqueued++
            if (shouldRenewWebhook) stats.watchRenewalJobsEnqueued++

            logger.debug('Enqueued refresh job', {
              integrationId: integration.id,
              refreshToken: shouldRefreshToken,
              renewWebhook: shouldRenewWebhook,
            })
          } catch (error: any) {
            // Job with same ID already exists - skip
            if (error.message?.includes('Job already exists')) {
              stats.alreadyQueued++
              continue
            }
            throw error
          }
        } else {
          if (shouldRefreshToken) stats.refreshJobsEnqueued++
          if (shouldRenewWebhook) stats.watchRenewalJobsEnqueued++
          logger.info('Would enqueue refresh job (dry run)', {
            integrationId: integration.id,
            refreshToken: shouldRefreshToken,
            renewWebhook: shouldRenewWebhook,
          })
        }
      } catch (error) {
        stats.errors++
        logger.error('Error processing integration', {
          integrationId: integration.id,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    await job.updateProgress(100)

    logger.info('Integration token refresh scanner completed', {
      stats,
      dryRun,
      jobId: job.id,
    })

    return { success: true, stats, dryRun }
  } catch (error) {
    logger.error('Integration token refresh scanner failed', {
      error: error instanceof Error ? error.message : String(error),
      stats,
      jobId: job.id,
    })
    throw error
  }
}

/**
 * Check if webhook/watch renewal is needed for an integration
 */
function checkWebhookRenewalNeeded(
  provider: 'google' | 'outlook',
  metadata: IntegrationMetadata | null,
  now: Date
): boolean {
  if (!metadata) return true // No metadata = needs setup

  if (provider === 'google') {
    const watchExpiration = metadata.watchExpiration
    if (!watchExpiration) return true // No watch = needs setup

    const expirationTime = new Date(Number(watchExpiration)).getTime()
    const timeUntilExpiry = expirationTime - now.getTime()
    return timeUntilExpiry <= GMAIL_WATCH_RENEWAL_BUFFER_MS
  }

  if (provider === 'outlook') {
    const subscriptionExpiration = metadata.subscriptionExpiration
    if (!subscriptionExpiration) return true // No subscription = needs setup

    const expirationTime = new Date(
      typeof subscriptionExpiration === 'string'
        ? subscriptionExpiration
        : Number(subscriptionExpiration)
    ).getTime()
    const timeUntilExpiry = expirationTime - now.getTime()
    return timeUntilExpiry <= OUTLOOK_SUBSCRIPTION_RENEWAL_BUFFER_MS
  }

  return false
}
