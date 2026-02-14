// packages/lib/src/jobs/maintenance/quota-reset-job.ts

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { Job } from 'bullmq'
import { and, eq, lte } from 'drizzle-orm'
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
 * Job handler to reset expired quota periods for system provider configurations.
 * Runs daily to check for quota periods that have ended and resets them.
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
    // Find all expired quota periods for system providers
    const expiredConfigs = await db.query.ProviderConfiguration.findMany({
      where: and(
        eq(schema.ProviderConfiguration.providerType, 'SYSTEM'),
        lte(schema.ProviderConfiguration.quotaPeriodEnd, now)
      ),
      limit: input.batchSize,
    })

    stats.scanned = expiredConfigs.length

    logger.info('Found expired quota periods', { count: expiredConfigs.length })

    if (input.dryRun) {
      logger.info('[DRY RUN] Would reset quotas', {
        configIds: expiredConfigs.map((c) => c.id),
        organizations: expiredConfigs.map((c) => c.organizationId),
      })
      return stats
    }

    // Process each expired configuration
    for (const config of expiredConfigs) {
      try {
        const newPeriodStart = new Date()
        const newPeriodEnd = new Date()
        newPeriodEnd.setMonth(newPeriodEnd.getMonth() + 1)

        await db
          .update(schema.ProviderConfiguration)
          .set({
            quotaUsed: 0,
            quotaPeriodStart: newPeriodStart,
            quotaPeriodEnd: newPeriodEnd,
            updatedAt: now,
          })
          .where(eq(schema.ProviderConfiguration.id, config.id))

        stats.resetCount++

        logger.debug('Reset quota for config', {
          configId: config.id,
          organizationId: config.organizationId,
          provider: config.provider,
          previousUsed: config.quotaUsed,
          previousPeriodEnd: config.quotaPeriodEnd,
          newPeriodEnd: newPeriodEnd.toISOString(),
        })
      } catch (error) {
        logger.error('Failed to reset quota for config', {
          configId: config.id,
          organizationId: config.organizationId,
          error: error instanceof Error ? error.message : String(error),
        })
        stats.errors++
      }

      // Update job progress
      const progress = ((stats.resetCount + stats.errors) / expiredConfigs.length) * 100
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
