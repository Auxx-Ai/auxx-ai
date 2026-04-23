// packages/lib/src/jobs/maintenance/quota-reset-job.ts

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { Job } from 'bullmq'
import { eq, lte } from 'drizzle-orm'
import { z } from 'zod'

const logger = createScopedLogger('quota-reset-job')

const payloadSchema = z.object({
  dryRun: z.boolean().default(false),
  batchSize: z.number().int().positive().default(100),
})

/**
 * Statistics tracking for the quota reset job
 */
export interface QuotaResetStats {
  scanned: number
  resetCount: number
  errors: number
  dryRun: boolean
}

/**
 * Daily job (1 AM UTC) that resets expired AI credit pools.
 * Scans `OrganizationAiQuota` for rows where `quotaPeriodEnd <= now` and
 * advances each to a fresh monthly window. Stripe `invoice.paid` is the
 * primary refresh path; this is the backstop for orgs without a recent
 * paid invoice (free tier, lapsed trials, missed webhooks).
 */
export const quotaResetJob = async (job: Job): Promise<QuotaResetStats> => {
  const input = payloadSchema.parse(job.data)
  const now = new Date()

  logger.info('Starting quota reset job', { jobId: job.id, dryRun: input.dryRun })

  const stats: QuotaResetStats = {
    scanned: 0,
    resetCount: 0,
    errors: 0,
    dryRun: input.dryRun,
  }

  try {
    const expired = await db.query.OrganizationAiQuota.findMany({
      where: lte(schema.OrganizationAiQuota.quotaPeriodEnd, now),
      limit: input.batchSize,
    })

    stats.scanned = expired.length

    logger.info('Found expired quota periods', { count: expired.length })

    if (input.dryRun) {
      logger.info('[DRY RUN] Would reset quotas', {
        organizations: expired.map((r) => r.organizationId),
      })
      return stats
    }

    for (const row of expired) {
      try {
        const newPeriodStart = new Date()
        const newPeriodEnd = new Date()
        newPeriodEnd.setMonth(newPeriodEnd.getMonth() + 1)

        await db
          .update(schema.OrganizationAiQuota)
          .set({
            quotaUsed: 0,
            quotaPeriodStart: newPeriodStart,
            quotaPeriodEnd: newPeriodEnd,
          })
          .where(eq(schema.OrganizationAiQuota.organizationId, row.organizationId))

        stats.resetCount++

        logger.debug('Reset quota for org', {
          organizationId: row.organizationId,
          previousUsed: row.quotaUsed,
          previousPeriodEnd: row.quotaPeriodEnd,
          newPeriodEnd: newPeriodEnd.toISOString(),
        })
      } catch (error) {
        logger.error('Failed to reset quota for org', {
          organizationId: row.organizationId,
          error: error instanceof Error ? error.message : String(error),
        })
        stats.errors++
      }

      const progress = ((stats.resetCount + stats.errors) / expired.length) * 100
      await job.updateProgress(Math.min(progress, 100))
    }

    logger.info('Quota reset job completed', stats)
    return stats
  } catch (error) {
    logger.error('Failed to complete quota reset job', {
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}
