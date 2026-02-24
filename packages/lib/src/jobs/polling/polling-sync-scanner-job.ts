// packages/lib/src/jobs/polling/polling-sync-scanner-job.ts

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { Job } from 'bullmq'
import { and, eq, inArray } from 'drizzle-orm'
import { resolveEffectiveSyncMode } from '../../providers/sync-mode-resolver'
import { getQueue } from '../queues'
import { Queues } from '../queues/types'

const logger = createScopedLogger('job:polling-sync-scanner')

const UNRECOVERABLE_AUTH_STATUSES = ['INVALID_GRANT', 'REVOKED_ACCESS', 'INSUFFICIENT_SCOPE']

export interface PollingSyncScannerJobData {
  dryRun?: boolean
}

/**
 * Scanner job that runs on a schedule (default: every 5 min).
 * Finds polling-mode integrations that need work and enqueues jobs.
 */
export const pollingSyncScannerJob = async (job: Job<PollingSyncScannerJobData>) => {
  const { dryRun = false } = job.data
  const now = new Date()

  logger.info('Starting polling sync scanner', { dryRun, jobId: job.id })

  const stats = {
    scanned: 0,
    listFetchEnqueued: 0,
    importEnqueued: 0,
    skippedActive: 0,
    skippedThrottled: 0,
    skippedAuthError: 0,
    skippedWebhookMode: 0,
    errors: 0,
  }

  try {
    const pollingSyncQueue = getQueue(Queues.pollingSyncQueue)

    // Query all enabled integrations with email providers
    const integrations = await db
      .select({
        id: schema.Integration.id,
        organizationId: schema.Integration.organizationId,
        provider: schema.Integration.provider,
        syncMode: schema.Integration.syncMode,
        syncStage: schema.Integration.syncStage,
        syncStatus: schema.Integration.syncStatus,
        lastSyncedAt: schema.Integration.lastSyncedAt,
        pollingIntervalMs: schema.Integration.pollingIntervalMs,
        throttleRetryAfter: schema.Integration.throttleRetryAfter,
        authStatus: schema.Integration.authStatus,
      })
      .from(schema.Integration)
      .where(
        and(
          eq(schema.Integration.enabled, true),
          inArray(schema.Integration.provider, ['google', 'outlook'])
        )
      )

    for (const integration of integrations) {
      stats.scanned++

      try {
        // Check if this integration uses polling mode
        const effectiveMode = resolveEffectiveSyncMode({
          syncMode: integration.syncMode,
          provider: integration.provider,
        })

        if (effectiveMode !== 'polling') {
          stats.skippedWebhookMode++
          continue
        }

        // Skip unrecoverable auth errors
        if (UNRECOVERABLE_AUTH_STATUSES.includes(integration.authStatus ?? '')) {
          stats.skippedAuthError++
          continue
        }

        // Skip throttled integrations
        if (integration.throttleRetryAfter && integration.throttleRetryAfter > now) {
          stats.skippedThrottled++
          continue
        }

        // Skip integrations currently in an active stage
        if (
          integration.syncStage === 'MESSAGE_LIST_FETCH' ||
          integration.syncStage === 'MESSAGES_IMPORT'
        ) {
          stats.skippedActive++
          continue
        }

        // Skip FAILED (handled by relaunch job)
        if (integration.syncStage === 'FAILED') {
          continue
        }

        // IDLE: check if sync is due
        if (integration.syncStage === 'IDLE') {
          const intervalMs = integration.pollingIntervalMs ?? 300000 // 5 min default
          const isDue =
            !integration.lastSyncedAt ||
            now.getTime() - integration.lastSyncedAt.getTime() > intervalMs

          if (!isDue) continue

          // Transition to MESSAGE_LIST_FETCH_PENDING
          if (!dryRun) {
            await db
              .update(schema.Integration)
              .set({
                syncStage: 'MESSAGE_LIST_FETCH_PENDING',
                updatedAt: now,
              })
              .where(eq(schema.Integration.id, integration.id))
          }
        }

        // MESSAGE_LIST_FETCH_PENDING: enqueue list-fetch job
        if (
          integration.syncStage === 'MESSAGE_LIST_FETCH_PENDING' ||
          integration.syncStage === 'IDLE' // Just transitioned above
        ) {
          if (!dryRun) {
            await pollingSyncQueue.add(
              'messageListFetchJob',
              {
                integrationId: integration.id,
                organizationId: integration.organizationId,
                provider: integration.provider,
              },
              {
                jobId: `poll-list-fetch-${integration.id}`,
                attempts: 3,
                backoff: { type: 'exponential', delay: 60000 },
                removeOnComplete: { count: 50 },
                removeOnFail: { count: 100 },
              }
            )
          }
          stats.listFetchEnqueued++
        }

        // MESSAGES_IMPORT_PENDING: enqueue import job
        if (integration.syncStage === 'MESSAGES_IMPORT_PENDING') {
          if (!dryRun) {
            await pollingSyncQueue.add(
              'messagesImportJob',
              {
                integrationId: integration.id,
                organizationId: integration.organizationId,
                provider: integration.provider,
              },
              {
                jobId: `poll-import-${integration.id}`,
                attempts: 3,
                backoff: { type: 'exponential', delay: 30000 },
                removeOnComplete: { count: 50 },
                removeOnFail: { count: 100 },
              }
            )
          }
          stats.importEnqueued++
        }
      } catch (error: any) {
        stats.errors++
        // Handle "Job already exists" — not an error
        if (error.message?.includes('Job already exists')) {
          continue
        }
        logger.error('Error processing integration in scanner', {
          integrationId: integration.id,
          error: error.message,
        })
      }
    }

    logger.info('Polling sync scanner completed', { stats, dryRun })
    return { success: true, stats }
  } catch (error) {
    logger.error('Polling sync scanner failed', {
      error: error instanceof Error ? error.message : String(error),
      stats,
    })
    throw error
  }
}
