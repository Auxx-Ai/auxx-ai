// packages/lib/src/jobs/polling/polling-relaunch-failed-job.ts

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { getImportCacheSize, recoverProcessingBatch } from '../../email/polling-import-cache'
import { resolveEffectiveSyncMode } from '../../providers/sync-mode-resolver'
import type { JobContext } from '../types'

const logger = createScopedLogger('job:polling-relaunch-failed')

export interface PollingRelaunchFailedJobData {
  maxRelaunches?: number
}

/**
 * Auto-recovery job that resets FAILED polling integrations.
 * Runs on schedule (default: every 30 min).
 */
export const pollingRelaunchFailedJob = async (_ctx: JobContext<PollingRelaunchFailedJobData>) => {
  const now = new Date()

  logger.info('Starting polling relaunch failed job')

  // Find failed integrations that are eligible for relaunch
  const failedIntegrations = await db
    .select({
      id: schema.Integration.id,
      provider: schema.Integration.provider,
      syncMode: schema.Integration.syncMode,
      metadata: schema.Integration.metadata,
      requiresReauth: schema.Credential.requiresReauth,
      throttleRetryAfter: schema.Integration.throttleRetryAfter,
    })
    .from(schema.Integration)
    .leftJoin(schema.Credential, eq(schema.Credential.id, schema.Integration.credentialId))
    .where(
      and(
        eq(schema.Integration.enabled, true),
        eq(schema.Integration.syncStage, 'FAILED'),
        inArray(schema.Integration.provider, ['google', 'outlook', 'imap']),
        isNull(schema.Integration.deletedAt)
      )
    )

  let relaunchedCount = 0

  for (const integration of failedIntegrations) {
    const effectiveMode = resolveEffectiveSyncMode({
      syncMode: integration.syncMode,
      provider: integration.provider,
    })

    // Relaunch polling-mode rows, plus webhook-mode rows whose INITIAL BACKFILL died —
    // the two-phase pipeline is their only way to get history, and the scanner (which
    // drives in-flight pipelines regardless of mode) can't act on a FAILED stage. The
    // incomplete-backfill predicate is what keeps this narrow: an arm-failure FAILED
    // stamped by outlookSubscriptionHealthJob has a completed backfill, and re-running
    // list-fetch would not fix a subscription problem. (Gmail webhook rows never carry
    // backfillCutoffAt today, so their behavior is unchanged until they adopt the
    // received-time cutoff mechanism.)
    if (effectiveMode !== 'polling') {
      const metadata = integration.metadata as Record<string, unknown> | null
      const backfillIncomplete =
        !!metadata?.backfillCutoffAt && !metadata?.initialBackfillCompletedAt
      if (!backfillIncomplete) continue
    }

    // Skip channels needing re-authentication
    if (integration.requiresReauth) continue

    // Skip integrations still in backoff
    if (integration.throttleRetryAfter && integration.throttleRetryAfter > now) continue

    // Recover any in-flight processing batch and check cache
    const recovered = await recoverProcessingBatch(integration.id)
    const cacheSize = await getImportCacheSize(integration.id)

    // If cache has IDs, resume from MESSAGES_IMPORT_PENDING (cursor already advanced)
    const resetStage = cacheSize > 0 ? 'MESSAGES_IMPORT_PENDING' : 'MESSAGE_LIST_FETCH_PENDING'

    await db
      .update(schema.Integration)
      .set({
        syncStage: resetStage,
        syncStatus: 'NOT_SYNCED',
        syncStageStartedAt: null,
        updatedAt: now,
      })
      .where(eq(schema.Integration.id, integration.id))

    relaunchedCount++

    logger.info('Relaunched failed integration', {
      integrationId: integration.id,
      provider: integration.provider,
      resetStage,
      recoveredFromProcessing: recovered,
      cacheSize,
    })
  }

  logger.info('Polling relaunch failed job completed', {
    totalFailed: failedIntegrations.length,
    relaunched: relaunchedCount,
  })

  return { success: true, relaunched: relaunchedCount }
}
