// packages/lib/src/jobs/polling/polling-sync-scanner-job.ts

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray, isNull, lt, lte, ne, or } from 'drizzle-orm'
import { resolveEffectiveSyncMode } from '../../providers/sync-mode-resolver'
import { getQueue } from '../queues'
import { Queues } from '../queues/types'
import type { JobContext } from '../types'

const logger = createScopedLogger('job:polling-sync-scanner')

/** Minimum interval between enqueue claims to prevent double-enqueue from overlapping scanners */
const CLAIM_COOLDOWN_MS = 30_000

export interface PollingSyncScannerJobData {
  dryRun?: boolean
}

/**
 * Scanner job that runs on a schedule (default: every 5 min).
 * Finds polling-mode integrations that need work and enqueues jobs.
 */
export const pollingSyncScannerJob = async (ctx: JobContext<PollingSyncScannerJobData>) => {
  const job = ctx.job
  const { dryRun = false } = job.data
  const now = new Date()

  logger.info('Starting polling sync scanner', { dryRun, jobId: job.id })

  const stats = {
    scanned: 0,
    listFetchEnqueued: 0,
    importEnqueued: 0,
    errors: 0,
  }

  try {
    const pollingSyncQueue = getQueue(Queues.pollingSyncQueue)

    // Providers whose 'auto' syncMode resolves to polling. Env-dependent but
    // process-wide, so compute once per tick and push into the WHERE — the
    // scan then returns only actionable polling-mode rows instead of every
    // enabled email integration. Never empty: imap always resolves to polling.
    const autoPollingProviders = (['google', 'outlook', 'imap'] as const).filter(
      (provider) => resolveEffectiveSyncMode({ syncMode: 'auto', provider }) === 'polling'
    )

    const integrations = await db
      .select({
        id: schema.Integration.id,
        organizationId: schema.Integration.organizationId,
        provider: schema.Integration.provider,
        syncStage: schema.Integration.syncStage,
        lastSyncedAt: schema.Integration.lastSyncedAt,
        pollingIntervalMs: schema.Integration.pollingIntervalMs,
      })
      .from(schema.Integration)
      .leftJoin(schema.Credential, eq(schema.Credential.id, schema.Integration.credentialId))
      .where(
        and(
          eq(schema.Integration.enabled, true),
          inArray(schema.Integration.provider, ['google', 'outlook', 'imap']),
          isNull(schema.Integration.deletedAt),
          // Two selection arms (FAILED is the relaunch job's; active stages skip):
          or(
            // 1. An in-flight two-phase pipeline is driven to completion REGARDLESS of
            //    sync mode. Webhook-mode channels enter these stages too — the Outlook
            //    arm-on-connect flow kicks messageListFetchJob for the initial backfill
            //    (webhook-push-migration plan Phase 2.4), and only this scanner advances
            //    MESSAGES_IMPORT_PENDING → messagesImportJob. Excluding webhook rows here
            //    stranded that backfill at MESSAGES_IMPORT_PENDING forever with zero
            //    messages imported. Draining ends at IDLE, which the arm below ignores
            //    for webhook rows — so this never turns into periodic polling.
            inArray(schema.Integration.syncStage, [
              'MESSAGE_LIST_FETCH_PENDING',
              'MESSAGES_IMPORT_PENDING',
            ]),
            // 2. New cycles (from IDLE) start ONLY for effective polling mode, mirroring
            //    resolveEffectiveSyncMode: explicit 'polling', or anything-but-'webhook'
            //    when the provider's auto mode resolves to polling.
            and(
              eq(schema.Integration.syncStage, 'IDLE'),
              or(
                eq(schema.Integration.syncMode, 'polling'),
                and(
                  ne(schema.Integration.syncMode, 'webhook'),
                  inArray(schema.Integration.provider, [...autoPollingProviders])
                )
              )
            )
          ),
          // Not throttled
          or(
            isNull(schema.Integration.throttleRetryAfter),
            lte(schema.Integration.throttleRetryAfter, now)
          ),
          // Not needing re-auth (null credential = no reauth flag = eligible)
          or(isNull(schema.Credential.requiresReauth), eq(schema.Credential.requiresReauth, false))
        )
      )

    for (const integration of integrations) {
      stats.scanned++

      try {
        // IDLE: check if sync is due and atomically transition
        if (integration.syncStage === 'IDLE') {
          const intervalMs = integration.pollingIntervalMs ?? 300000 // 5 min default
          const isDue =
            !integration.lastSyncedAt ||
            now.getTime() - integration.lastSyncedAt.getTime() > intervalMs

          if (!isDue) continue

          if (!dryRun) {
            // Atomic conditional UPDATE — only transition if still IDLE
            const [updated] = await db
              .update(schema.Integration)
              .set({
                syncStage: 'MESSAGE_LIST_FETCH_PENDING',
                syncStageStartedAt: now,
                updatedAt: now,
              })
              .where(
                and(
                  eq(schema.Integration.id, integration.id),
                  eq(schema.Integration.syncStage, 'IDLE')
                )
              )
              .returning({ id: schema.Integration.id })

            if (!updated) continue // Another scanner already transitioned it
          }

          // Enqueue list-fetch job with unique ID
          if (!dryRun) {
            await pollingSyncQueue.add(
              'messageListFetchJob',
              {
                integrationId: integration.id,
                organizationId: integration.organizationId,
                provider: integration.provider,
              },
              {
                jobId: `poll-list-fetch-${integration.id}-${Date.now()}`,
                attempts: 3,
                backoff: { type: 'exponential', delay: 60000 },
                removeOnComplete: { count: 50 },
                removeOnFail: { count: 100 },
              }
            )
          }
          stats.listFetchEnqueued++
          continue
        }

        // MESSAGE_LIST_FETCH_PENDING: atomically claim and enqueue list-fetch job
        if (integration.syncStage === 'MESSAGE_LIST_FETCH_PENDING') {
          if (!dryRun) {
            const [claimed] = await db
              .update(schema.Integration)
              .set({ syncStageStartedAt: now, updatedAt: now })
              .where(
                and(
                  eq(schema.Integration.id, integration.id),
                  eq(schema.Integration.syncStage, 'MESSAGE_LIST_FETCH_PENDING'),
                  or(
                    isNull(schema.Integration.syncStageStartedAt),
                    lt(
                      schema.Integration.syncStageStartedAt,
                      new Date(Date.now() - CLAIM_COOLDOWN_MS)
                    )
                  )
                )
              )
              .returning({ id: schema.Integration.id })

            if (!claimed) continue

            await pollingSyncQueue.add(
              'messageListFetchJob',
              {
                integrationId: integration.id,
                organizationId: integration.organizationId,
                provider: integration.provider,
              },
              {
                jobId: `poll-list-fetch-${integration.id}-${Date.now()}`,
                attempts: 3,
                backoff: { type: 'exponential', delay: 60000 },
                removeOnComplete: { count: 50 },
                removeOnFail: { count: 100 },
              }
            )
          }
          stats.listFetchEnqueued++
          continue
        }

        // MESSAGES_IMPORT_PENDING: atomically claim and enqueue import job
        if (integration.syncStage === 'MESSAGES_IMPORT_PENDING') {
          if (!dryRun) {
            const [claimed] = await db
              .update(schema.Integration)
              .set({ syncStageStartedAt: now, updatedAt: now })
              .where(
                and(
                  eq(schema.Integration.id, integration.id),
                  eq(schema.Integration.syncStage, 'MESSAGES_IMPORT_PENDING'),
                  or(
                    isNull(schema.Integration.syncStageStartedAt),
                    lt(
                      schema.Integration.syncStageStartedAt,
                      new Date(Date.now() - CLAIM_COOLDOWN_MS)
                    )
                  )
                )
              )
              .returning({ id: schema.Integration.id })

            if (!claimed) continue

            await pollingSyncQueue.add(
              'messagesImportJob',
              {
                integrationId: integration.id,
                organizationId: integration.organizationId,
                provider: integration.provider,
              },
              {
                jobId: `poll-import-${integration.id}-${Date.now()}`,
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
