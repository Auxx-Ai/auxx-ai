// packages/lib/src/jobs/maintenance/stale-pending-message-sweeper-job.ts

import { database, schema } from '@auxx/database'
import { SendStatus } from '@auxx/database/enums'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, lt, sql } from 'drizzle-orm'
import type { JobContext } from '../types'

const logger = createScopedLogger('stale-pending-message-sweeper')

interface StalePendingMessageSweeperJobData {
  /**
   * Messages still PENDING this many minutes after creation are considered
   * stranded and flipped to FAILED. The send path is synchronous and completes
   * in seconds, so anything older than a few minutes never finished its send.
   * Defaults to 5.
   */
  staleMinutes?: number
  batchSize?: number
  dryRun?: boolean
}

export interface StalePendingMessageSweeperStats {
  swept: number
}

/**
 * Recovers outbound messages stranded in PENDING.
 *
 * The immediate send path creates the Message row as PENDING, then sends and
 * reconciles synchronously within the request. A clean provider failure already
 * lands as FAILED, but if the process dies mid-request (e.g. a deploy/restart
 * between row creation and reconciliation) the row is never revisited: it stays
 * PENDING forever, retry rejects non-FAILED rows, and the viewer shows a
 * permanent "being sent" spinner.
 *
 * This sweep flips those abandoned rows to FAILED so they become retryable and
 * render correctly. The in-request catch handles the common case; this covers
 * the hard process-death case where no catch can run.
 */
export async function stalePendingMessageSweeperJob(
  ctx: JobContext<StalePendingMessageSweeperJobData>
): Promise<StalePendingMessageSweeperStats> {
  const job = ctx.job
  const { staleMinutes = 5, batchSize = 500, dryRun = false } = job.data
  const cutoff = new Date(Date.now() - staleMinutes * 60 * 1000)

  logger.info('Starting stale PENDING message sweep', { staleMinutes, batchSize, dryRun, cutoff })

  const candidates = await database
    .select({ id: schema.Message.id, organizationId: schema.Message.organizationId })
    .from(schema.Message)
    .where(
      and(eq(schema.Message.sendStatus, SendStatus.PENDING), lt(schema.Message.createdAt, cutoff))
    )
    .limit(batchSize)

  if (candidates.length === 0) {
    logger.info('Stale PENDING message sweep finished', { swept: 0 })
    return { swept: 0 }
  }

  if (dryRun) {
    logger.info('Stale PENDING message sweep (dry run)', {
      swept: candidates.length,
      ids: candidates.map((c) => c.id),
    })
    return { swept: candidates.length }
  }

  // Re-assert the PENDING + cutoff predicate in the UPDATE so an in-flight send
  // that reconciles between the select and the write isn't clobbered.
  const now = new Date()
  await database
    .update(schema.Message)
    .set({
      sendStatus: SendStatus.FAILED,
      providerError: 'Send did not complete (stranded in PENDING and swept).',
      lastAttemptAt: now,
      attempts: sql`${schema.Message.attempts} + 1`,
      updatedAt: now,
    })
    .where(
      and(eq(schema.Message.sendStatus, SendStatus.PENDING), lt(schema.Message.createdAt, cutoff))
    )

  logger.info('Stale PENDING message sweep finished', {
    swept: candidates.length,
    ids: candidates.map((c) => c.id),
  })
  return { swept: candidates.length }
}
