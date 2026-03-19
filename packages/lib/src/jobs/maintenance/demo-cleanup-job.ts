// packages/lib/src/jobs/maintenance/demo-cleanup-job.ts

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { Job } from 'bullmq'
import { and, isNotNull, lt } from 'drizzle-orm'
import { isDemoEnabled } from '../../demo'
import { OrganizationService } from '../../organizations'

const logger = createScopedLogger('demo-cleanup')

export interface DemoCleanupStats {
  scanned: number
  deleted: number
  failed: number
}

/**
 * Job handler for cleaning up expired demo organizations.
 * Runs on a repeatable schedule (every 15 minutes) in the maintenance queue.
 * Deletes demo orgs whose demoExpiresAt has passed using OrganizationService.deleteOrganization.
 */
export const demoCleanupJob = async (job: Job) => {
  if (!isDemoEnabled()) {
    logger.info('Demo disabled, skipping cleanup')
    return { scanned: 0, deleted: 0, failed: 0 }
  }

  const batchSize = (job.data?.batchSize as number) ?? 50
  const dryRun = (job.data?.dryRun as boolean) ?? false

  const stats: DemoCleanupStats = {
    scanned: 0,
    deleted: 0,
    failed: 0,
  }

  logger.info('Starting demo cleanup', { jobId: job.id, dryRun, batchSize })

  try {
    // Find expired demo orgs
    const expiredOrgs = await db
      .select({
        id: schema.Organization.id,
        name: schema.Organization.name,
      })
      .from(schema.Organization)
      .where(
        and(
          isNotNull(schema.Organization.demoExpiresAt),
          lt(schema.Organization.demoExpiresAt, new Date())
        )
      )
      .limit(batchSize)

    stats.scanned = expiredOrgs.length

    if (expiredOrgs.length === 0) {
      logger.info('No expired demo orgs found')
      return stats
    }

    logger.info(`Found ${expiredOrgs.length} expired demo orgs to clean up`)

    for (let i = 0; i < expiredOrgs.length; i++) {
      const org = expiredOrgs[i]!

      if (dryRun) {
        logger.info(`[DRY RUN] Would delete demo org ${org.id} (${org.name})`)
        stats.deleted++
        continue
      }

      try {
        const orgService = new OrganizationService(db)
        await orgService.deleteOrganization({
          organizationId: org.id,
          skipEmailConfirmation: true,
          isSystemDeletion: true,
        })

        stats.deleted++
        logger.info(`Deleted expired demo org`, {
          organizationId: org.id,
          organizationName: org.name,
        })
      } catch (error) {
        stats.failed++
        logger.error(`Failed to delete demo org ${org.id}`, { error })
      }

      // Update progress
      const progress = Math.round(((i + 1) / expiredOrgs.length) * 100)
      await job.updateProgress(progress)
    }

    logger.info('Demo cleanup completed', stats)
    return stats
  } catch (error) {
    logger.error('Failed to complete demo cleanup', { error })
    throw error
  }
}
