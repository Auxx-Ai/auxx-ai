// packages/lib/src/jobs/maintenance/outlook-subscription-health-job.ts

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm'
import { armOutlookSubscription } from '../../providers/outlook/outlook-subscription'
import { ProviderRegistryService } from '../../providers/provider-registry-service'
import { resolveEffectiveSyncMode } from '../../providers/sync-mode-resolver'
import { enqueueOutlookPushSync } from '../messages/outlook-push-sync-job'
import type { JobContext } from '../types'

const logger = createScopedLogger('outlook-subscription-health')

/** Health job payload */
export interface OutlookSubscriptionHealthJobData {
  dryRun?: boolean
}

/**
 * A quiet mailbox legitimately has an old `lastSyncedAt` — only a live `GET
 * /subscriptions/{id}` distinguishes "quiet" from "dead". This is the threshold past which
 * that verification GET is worth paying for (plan §3.2/Phase 4.3, open question 2 — 2h is a
 * starting guess, not a tuned value).
 */
const SYNC_STALENESS_THRESHOLD_MS = 2 * 60 * 60 * 1000

/** Consecutive arm failures before the channel card flips to Sync Error (plan Phase 4.4). */
const ARM_FAILURES_BEFORE_SYNC_ERROR = 3

interface OutlookSubscriptionMetadata {
  graphSubscriptionId?: string
  subscriptionExpiration?: string | number
  outlookSubscription?: {
    expiresAt?: string
    consecutiveArmFailures?: number
  }
  [key: string]: unknown
}

interface HealthJobStats {
  scanned: number
  skippedReauth: number
  skippedNonWebhook: number
  reArmed: number
  reArmFailed: number
  quietMailboxVerified: number
  catchUpSyncEnqueued: number
  markedSyncError: number
  errors: number
}

/** Narrow capability surface — `checkSubscription` is Outlook-specific, not on the base
 *  `ChannelProvider` interface, hence the runtime guard everywhere this type is used. */
interface CheckSubscriptionCapable {
  checkSubscription(): Promise<'active' | 'missing' | 'none'>
}

/**
 * Outlook subscription health sweep (webhook-push-migration plan §3.2, Phase 4.3/4.4).
 *
 * Push is the ONLY live inbound pipeline for a webhook-mode Outlook channel — there is no
 * parallel polling scanner backstopping it (§3.2 deliberately rejected running both: two
 * cursors advancing independently doubles Graph calls and makes "why did this message
 * arrive twice / not at all" untraceable). This hourly job is the explicit recovery path
 * that plays the role polling-in-parallel would otherwise have played:
 *
 * - **Dead/never-armed** subscriptions (no stored id, no expiry, or expired) are re-armed
 *   unconditionally — `armOutlookSubscription` seeds the delta cursor if one is missing and
 *   is safe to call repeatedly.
 * - **Possibly-silent** subscriptions (stored and unexpired, but `lastSyncedAt` has gone
 *   stale) are verified server-side via `checkSubscription()` before touching anything — a
 *   quiet mailbox is not a dead one, and re-arming on staleness alone would be wrong.
 *   Verified-missing subscriptions are re-armed AND followed by one `outlookPushSyncJob` to
 *   catch up on whatever arrived while the subscription was silently dead.
 * - Repeated arm failures are counted in `metadata.outlookSubscription.consecutiveArmFailures`
 *   and, past a threshold, flip `syncStatus` to `'FAILED'` so the channel card shows Sync
 *   Error instead of a latched `ACTIVE` (plan Phase 4.4). `armOutlookSubscription`'s success
 *   path is the only place that un-fails a card — a clean arm here clears it the same way.
 */
export const outlookSubscriptionHealthJob = async (
  ctx: JobContext<OutlookSubscriptionHealthJobData>
) => {
  const job = ctx.job
  const { dryRun = false } = job.data

  logger.info('Starting Outlook subscription health sweep', { dryRun, jobId: job.id })

  const stats: HealthJobStats = {
    scanned: 0,
    skippedReauth: 0,
    skippedNonWebhook: 0,
    reArmed: 0,
    reArmFailed: 0,
    quietMailboxVerified: 0,
    catchUpSyncEnqueued: 0,
    markedSyncError: 0,
    errors: 0,
  }

  try {
    const now = new Date()

    const rows = await db
      .select({
        id: schema.Integration.id,
        organizationId: schema.Integration.organizationId,
        syncMode: schema.Integration.syncMode,
        metadata: schema.Integration.metadata,
        webhookRouteKey: schema.Integration.webhookRouteKey,
        lastSyncedAt: schema.Integration.lastSyncedAt,
        syncStatus: schema.Integration.syncStatus,
        requiresReauth: schema.Credential.requiresReauth,
      })
      .from(schema.Integration)
      .leftJoin(schema.Credential, eq(schema.Credential.id, schema.Integration.credentialId))
      .where(
        and(
          eq(schema.Integration.provider, 'outlook'),
          eq(schema.Integration.enabled, true),
          isNull(schema.Integration.deletedAt),
          isNotNull(schema.Integration.credentialId)
        )
      )

    logger.info('Scanning Outlook channels for subscription health', { count: rows.length })

    for (const row of rows) {
      stats.scanned++

      try {
        if (row.requiresReauth) {
          stats.skippedReauth++
          continue
        }

        // Polling channels are the polling scanner's problem, not this job's.
        const effectiveMode = resolveEffectiveSyncMode({
          syncMode: row.syncMode,
          provider: 'outlook',
        })
        if (effectiveMode !== 'webhook') {
          stats.skippedNonWebhook++
          continue
        }

        const metadata = row.metadata as OutlookSubscriptionMetadata | null
        const storedId = row.webhookRouteKey ?? metadata?.graphSubscriptionId
        const expiresAtRaw =
          metadata?.outlookSubscription?.expiresAt ?? metadata?.subscriptionExpiration
        const isDeadOrExpired = !storedId || !expiresAtRaw || new Date(expiresAtRaw) <= now

        if (isDeadOrExpired) {
          if (dryRun) {
            logger.info('[dry run] would re-arm dead/expired Outlook subscription', {
              integrationId: row.id,
              hadStoredId: !!storedId,
              hadExpiry: !!expiresAtRaw,
            })
            continue
          }
          await reArmChannel(row.id, row.organizationId, stats)
          continue
        }

        const isStale =
          !row.lastSyncedAt ||
          now.getTime() - row.lastSyncedAt.getTime() > SYNC_STALENESS_THRESHOLD_MS
        if (!isStale) continue

        const provider = await new ProviderRegistryService(row.organizationId).getProvider(row.id)
        if (
          typeof (provider as unknown as CheckSubscriptionCapable).checkSubscription !== 'function'
        ) {
          logger.warn('Provider has no checkSubscription — skipping staleness verification', {
            integrationId: row.id,
          })
          continue
        }

        const status = await (provider as unknown as CheckSubscriptionCapable).checkSubscription()

        if (status === 'active') {
          // Quiet mailbox — the GET is exactly what distinguishes this from dead. Never
          // re-arm on staleness alone.
          stats.quietMailboxVerified++
          continue
        }

        // 'missing' or 'none' — the subscription is silently dead server-side.
        if (dryRun) {
          logger.info('[dry run] would re-arm silently-dead Outlook subscription', {
            integrationId: row.id,
            status,
          })
          continue
        }

        const reArmed = await reArmChannel(row.id, row.organizationId, stats)
        if (reArmed) {
          await enqueueOutlookPushSync({
            integrationId: row.id,
            organizationId: row.organizationId,
          })
          stats.catchUpSyncEnqueued++
        }
      } catch (error) {
        stats.errors++
        logger.error('Error checking Outlook channel subscription health', {
          integrationId: row.id,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    logger.info('Outlook subscription health sweep completed', { stats, dryRun, jobId: job.id })

    return { success: true, stats, dryRun }
  } catch (error) {
    logger.error('Outlook subscription health sweep failed', {
      error: error instanceof Error ? error.message : String(error),
      stats,
      jobId: job.id,
    })
    throw error
  }
}

/**
 * Re-arm one channel and track the outcome. On failure, bumps
 * `metadata.outlookSubscription.consecutiveArmFailures` via a jsonb merge (never a
 * read-modify-replace — this runs alongside other concurrent metadata writers) and, past
 * {@link ARM_FAILURES_BEFORE_SYNC_ERROR}, flips `syncStatus` to `'FAILED'`.
 *
 * Returns whether the arm succeeded.
 */
async function reArmChannel(
  integrationId: string,
  organizationId: string,
  stats: HealthJobStats
): Promise<boolean> {
  try {
    await armOutlookSubscription({ integrationId, organizationId })
    stats.reArmed++
    return true
  } catch (error) {
    stats.reArmFailed++
    const message = error instanceof Error ? error.message : String(error)
    logger.error('Outlook subscription re-arm failed', { integrationId, error: message })
    await recordArmFailure(integrationId, message, stats)
    return false
  }
}

/** Increments the consecutive-arm-failure counter and escalates to `syncStatus: 'FAILED'`
 *  once it crosses {@link ARM_FAILURES_BEFORE_SYNC_ERROR}. */
async function recordArmFailure(
  integrationId: string,
  errorMessage: string,
  stats: HealthJobStats
): Promise<void> {
  const [updated] = await db
    .update(schema.Integration)
    .set({
      metadata: sql`COALESCE(${schema.Integration.metadata}, '{}'::jsonb) || jsonb_build_object(
        'outlookSubscription',
        COALESCE(${schema.Integration.metadata}->'outlookSubscription', '{}'::jsonb) || jsonb_build_object(
          'consecutiveArmFailures',
          COALESCE((${schema.Integration.metadata}->'outlookSubscription'->>'consecutiveArmFailures')::int, 0) + 1,
          'lastError', ${errorMessage}::text
        )
      )`,
      updatedAt: new Date(),
    })
    .where(eq(schema.Integration.id, integrationId))
    .returning({ metadata: schema.Integration.metadata })

  const consecutiveArmFailures =
    (updated?.metadata as OutlookSubscriptionMetadata | undefined)?.outlookSubscription
      ?.consecutiveArmFailures ?? 0

  if (consecutiveArmFailures >= ARM_FAILURES_BEFORE_SYNC_ERROR) {
    await db
      .update(schema.Integration)
      .set({ syncStatus: 'FAILED', updatedAt: new Date() })
      .where(eq(schema.Integration.id, integrationId))
    stats.markedSyncError++
    logger.warn('Outlook channel marked syncStatus FAILED after repeated arm failures', {
      integrationId,
      consecutiveArmFailures,
    })
  }
}
