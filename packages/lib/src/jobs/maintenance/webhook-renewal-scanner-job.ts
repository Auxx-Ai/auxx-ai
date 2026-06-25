// packages/lib/src/jobs/maintenance/webhook-renewal-scanner-job.ts

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import { resolveEffectiveSyncMode } from '../../providers/sync-mode-resolver'
import { getQueue, Queues } from '../queues'
import type { JobContext } from '../types'

const logger = createScopedLogger('webhook-renewal-scanner')

/** Scanner job payload */
export interface WebhookRenewalScannerJobData {
  dryRun?: boolean
}

/** Scanner statistics */
interface ScannerStats {
  integrationsScanned: number
  watchRenewalJobsEnqueued: number
  skippedAuthError: number
  alreadyQueued: number
  errors: number
}

/** Integration metadata structure for type safety */
interface ChannelMetadata {
  watchExpiration?: number | string
  subscriptionExpiration?: number | string
  [key: string]: unknown
}

// Renew Gmail watch 1 day before expiration (watch lasts 7 days)
const GMAIL_WATCH_RENEWAL_BUFFER_MS = 24 * 60 * 60 * 1000

// Renew Outlook subscription 1 day before expiration (subscription lasts ~3 days)
const OUTLOOK_SUBSCRIPTION_RENEWAL_BUFFER_MS = 24 * 60 * 60 * 1000

// Supported OAuth providers
const OAUTH_PROVIDERS = ['google', 'outlook'] as const

/**
 * Webhook Renewal Scanner Job:
 *
 * Scans enabled webhook-mode email channels and enqueues renewal jobs for:
 * - Gmail watches nearing expiration
 * - Outlook subscriptions nearing expiration
 *
 * Token refresh is handled separately by the unified `oauth2-token-refresh-scanner-job`
 * (integration pass) + lazy resolver refresh — this scanner only keeps the push channel armed.
 *
 * Runs every 15 minutes via cron.
 */
export const webhookRenewalScannerJob = async (ctx: JobContext<WebhookRenewalScannerJobData>) => {
  const job = ctx.job
  const { dryRun = false } = job.data

  logger.info('Starting webhook renewal scanner', {
    dryRun,
    jobId: job.id,
  })

  const stats: ScannerStats = {
    integrationsScanned: 0,
    watchRenewalJobsEnqueued: 0,
    skippedAuthError: 0,
    alreadyQueued: 0,
    errors: 0,
  }

  try {
    await job.updateProgress(10)
    const now = new Date()
    const maintenanceQueue = getQueue(Queues.maintenanceQueue)

    // Query enabled OAuth integrations with a linked credential — candidates for webhook renewal.
    const integrations = await db
      .select({
        id: schema.Integration.id,
        organizationId: schema.Integration.organizationId,
        provider: schema.Integration.provider,
        syncMode: schema.Integration.syncMode,
        requiresReauth: schema.Credential.requiresReauth,
        metadata: schema.Integration.metadata,
      })
      .from(schema.Integration)
      .leftJoin(schema.Credential, eq(schema.Credential.id, schema.Integration.credentialId))
      .where(
        and(
          inArray(schema.Integration.provider, [...OAUTH_PROVIDERS]),
          isNotNull(schema.Integration.credentialId),
          eq(schema.Integration.enabled, true),
          isNull(schema.Integration.deletedAt)
        )
      )

    logger.info('Scanning channels for webhook renewal', { count: integrations.length })

    await job.updateProgress(50)

    for (const integration of integrations) {
      stats.integrationsScanned++

      try {
        // Skip channels needing re-authentication (user must reconnect)
        if (integration.requiresReauth) {
          stats.skippedAuthError++
          logger.debug('Skipping channel with auth error', { integrationId: integration.id })
          continue
        }

        // Webhook renewal only applies to webhook-mode channels.
        const effectiveMode = resolveEffectiveSyncMode({
          syncMode: integration.syncMode,
          provider: integration.provider,
        })
        if (effectiveMode !== 'webhook') continue

        const metadata = integration.metadata as ChannelMetadata | null
        const needsRenewal = checkWebhookRenewalNeeded(
          integration.provider as 'google' | 'outlook',
          metadata,
          now
        )
        if (!needsRenewal) continue

        // Use stable job ID to prevent duplicate jobs for same integration
        const jobId = `webhook-renewal-${integration.id}`

        if (!dryRun) {
          try {
            await maintenanceQueue.add(
              'webhookRenewalJob',
              {
                integrationId: integration.id,
                organizationId: integration.organizationId,
                provider: integration.provider,
              },
              {
                jobId,
                attempts: 3,
                backoff: { type: 'exponential', delay: 60000 },
                removeOnComplete: { count: 100 },
                removeOnFail: { count: 500 },
              }
            )
            stats.watchRenewalJobsEnqueued++
            logger.debug('Enqueued webhook renewal job', { integrationId: integration.id })
          } catch (error: any) {
            // Job with same ID already exists - skip
            if (error.message?.includes('Job already exists')) {
              stats.alreadyQueued++
              continue
            }
            throw error
          }
        } else {
          stats.watchRenewalJobsEnqueued++
          logger.info('Would enqueue webhook renewal job (dry run)', {
            integrationId: integration.id,
          })
        }
      } catch (error) {
        stats.errors++
        logger.error('Error processing channel', {
          integrationId: integration.id,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    await job.updateProgress(100)

    logger.info('Webhook renewal scanner completed', {
      stats,
      dryRun,
      jobId: job.id,
    })

    return { success: true, stats, dryRun }
  } catch (error) {
    logger.error('Webhook renewal scanner failed', {
      error: error instanceof Error ? error.message : String(error),
      stats,
      jobId: job.id,
    })
    throw error
  }
}

/**
 * Check if webhook/watch renewal is needed for a channel
 */
function checkWebhookRenewalNeeded(
  provider: 'google' | 'outlook',
  metadata: ChannelMetadata | null,
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
