// packages/lib/src/jobs/maintenance/expired-trial-account-cleanup-job.ts

import type { Job } from 'bullmq'
import { z } from 'zod'
import { createScopedLogger } from '@auxx/logger'
import { subDays } from 'date-fns'
import { database as db, schema } from '@auxx/database'
import { eq, and, inArray, isNull } from 'drizzle-orm'

import { OrganizationService } from '../../organizations'
import { sendTrialDeletionWarningEmail, sendTrialDeletionFinalEmail } from '@auxx/email'
import { WEBAPP_URL } from '@auxx/config/server'

const payloadSchema = z.object({
  dryRun: z.boolean().default(false),
  gracePeriodDays: z.number().int().positive().default(14),
  batchSize: z.number().int().positive().default(10),
  sendNotifications: z.boolean().default(true),
})

const logger = createScopedLogger('expired-trial-cleanup')

/**
 * Statistics tracking for the cleanup job
 */
export interface CleanupStats {
  scanned: number
  deleted: number
  skipped: number
  errors: number
  notificationsWarning: number
  notificationsFinal: number
}

/**
 * Organization eligible for deletion
 */
export interface OrganizationToDelete {
  organizationId: string
  organizationName: string
  ownerEmail: string | null
  trialEnd: Date
  trialConversionStatus: string
  lastNotificationSent: string | null
}

/**
 * Main job handler for expired trial account cleanup.
 * Runs daily to identify and delete trial accounts that have been expired for the grace period.
 * Includes notification system to warn users before deletion.
 */
export const expiredTrialAccountCleanupJob = async (job: Job) => {
  const input = payloadSchema.parse(job.data)
  const stats: CleanupStats = {
    scanned: 0,
    deleted: 0,
    skipped: 0,
    errors: 0,
    notificationsWarning: 0,
    notificationsFinal: 0,
  }

  logger.info('Starting expired trial cleanup', {
    jobId: job.id,
    dryRun: input.dryRun,
    gracePeriodDays: input.gracePeriodDays,
  })

  try {
    // Calculate cutoff dates
    const deletionCutoff = subDays(new Date(), input.gracePeriodDays)
    const warningCutoff = subDays(new Date(), 7)
    const finalNoticeCutoff = subDays(new Date(), 1)

    logger.info('Calculated cutoff dates', {
      deletionCutoff: deletionCutoff.toISOString(),
      warningCutoff: warningCutoff.toISOString(),
      finalNoticeCutoff: finalNoticeCutoff.toISOString(),
    })

    // Find eligible organizations
    const eligibleOrgs = await findEligibleOrganizations(
      deletionCutoff,
      warningCutoff,
      finalNoticeCutoff
    )

    stats.scanned =
      eligibleOrgs.deletionReady.length +
      eligibleOrgs.warningNeeded.length +
      eligibleOrgs.finalNoticeNeeded.length

    logger.info('Found eligible organizations', {
      deletionReady: eligibleOrgs.deletionReady.length,
      warningNeeded: eligibleOrgs.warningNeeded.length,
      finalNoticeNeeded: eligibleOrgs.finalNoticeNeeded.length,
    })

    // Process notifications
    if (input.sendNotifications && !input.dryRun) {
      await processNotifications(eligibleOrgs, stats)
    } else if (input.dryRun) {
      logger.info('[DRY RUN] Would send notifications', {
        warningEmails: eligibleOrgs.warningNeeded.length,
        finalNoticeEmails: eligibleOrgs.finalNoticeNeeded.length,
      })
    }

    // Process deletions in batches
    for (let i = 0; i < eligibleOrgs.deletionReady.length; i += input.batchSize) {
      const batch = eligibleOrgs.deletionReady.slice(i, i + input.batchSize)
      await processDeletionBatch(batch, input.dryRun, stats)

      // Update job progress
      const progress = ((i + batch.length) / eligibleOrgs.deletionReady.length) * 100
      await job.updateProgress(Math.min(progress, 100))
    }

    logger.info('Expired trial cleanup completed', stats)
    return stats
  } catch (error) {
    logger.error('Failed to complete expired trial cleanup', { error })
    throw error
  }
}

/**
 * Find organizations eligible for deletion, warning, or final notice
 */
async function findEligibleOrganizations(
  deletionCutoff: Date,
  warningCutoff: Date,
  finalNoticeCutoff: Date
) {
  const { PlanSubscription } = await import('@auxx/database')
  const { Organization } = await import('@auxx/database')

  // Query for organizations with expired trials
  const expiredTrials = await db
    .select({
      organizationId: schema.PlanSubscription.organizationId,
      trialEnd: schema.PlanSubscription.trialEnd,
      trialConversionStatus: schema.PlanSubscription.trialConversionStatus,
      hasTrialEnded: schema.PlanSubscription.hasTrialEnded,
      lastNotificationSent: schema.PlanSubscription.lastDeletionNotificationSent,
      organizationName: schema.Organization.name,
      ownerEmail: schema.User.email,
    })
    .from(schema.PlanSubscription)
    .innerJoin(
      schema.Organization,
      eq(schema.Organization.id, schema.PlanSubscription.organizationId)
    )
    .innerJoin(schema.User, eq(schema.User.id, schema.Organization.createdById))
    .where(
      and(
        eq(schema.PlanSubscription.hasTrialEnded, true),
        inArray(schema.PlanSubscription.trialConversionStatus, [
          'EXPIRED_WITHOUT_CONVERSION',
          'CANCELED_DURING_TRIAL',
        ]),
        isNull(schema.PlanSubscription.stripeSubscriptionId) // No active subscription
      )
    )

  // Categorize organizations
  const deletionReady: OrganizationToDelete[] = []
  const warningNeeded: OrganizationToDelete[] = []
  const finalNoticeNeeded: OrganizationToDelete[] = []

  for (const org of expiredTrials) {
    if (!org.trialEnd) {
      logger.warn('Organization has null trialEnd, skipping', {
        organizationId: org.organizationId,
        organizationName: org.organizationName,
      })
      continue
    }

    const daysSinceExpiry = Math.floor(
      (Date.now() - org.trialEnd.getTime()) / (1000 * 60 * 60 * 24)
    )

    const orgData: OrganizationToDelete = {
      organizationId: org.organizationId,
      organizationName: org.organizationName,
      ownerEmail: org.ownerEmail,
      trialEnd: org.trialEnd,
      trialConversionStatus: org.trialConversionStatus || 'EXPIRED_WITHOUT_CONVERSION',
      lastNotificationSent: org.lastNotificationSent,
    }

    if (daysSinceExpiry >= 14) {
      deletionReady.push(orgData)
    } else if (daysSinceExpiry >= 7 && !org.lastNotificationSent?.includes('WARNING')) {
      warningNeeded.push(orgData)
    } else if (daysSinceExpiry >= 13 && !org.lastNotificationSent?.includes('FINAL')) {
      finalNoticeNeeded.push(orgData)
    }
  }

  return {
    deletionReady,
    warningNeeded,
    finalNoticeNeeded,
  }
}

/**
 * Send notification emails for warning and final notices
 */
async function processNotifications(
  eligibleOrgs: {
    warningNeeded: OrganizationToDelete[]
    finalNoticeNeeded: OrganizationToDelete[]
  },
  stats: CleanupStats
) {
  // Send warning emails (7 days before deletion)
  for (const org of eligibleOrgs.warningNeeded) {
    try {
      if (!org.ownerEmail) {
        logger.warn('Skipping warning email due to missing owner email', {
          organizationId: org.organizationId,
          organizationName: org.organizationName,
        })
        stats.skipped++
        continue
      }

      await sendTrialDeletionWarningEmail({
        email: org.ownerEmail,
        organizationName: org.organizationName,
        daysUntilDeletion: 7,
        reactivationLink: `${WEBAPP_URL}/subscription/reactivate/${org.organizationId}`,
      })

      // Update notification status in database
      await db
        .update(schema.PlanSubscription)
        .set({
          lastDeletionNotificationSent: 'WARNING',
          lastDeletionNotificationDate: new Date(),
        })
        .where(eq(schema.PlanSubscription.organizationId, org.organizationId))

      stats.notificationsWarning++
      logger.info('Sent deletion warning email', {
        organizationId: org.organizationId,
        organizationName: org.organizationName,
        ownerEmail: org.ownerEmail,
      })
    } catch (error) {
      logger.error('Failed to send warning email', {
        organizationId: org.organizationId,
        error,
      })
      stats.errors++
    }
  }

  // Send final notice emails (24 hours before deletion)
  for (const org of eligibleOrgs.finalNoticeNeeded) {
    try {
      if (!org.ownerEmail) {
        logger.warn('Skipping final notice email due to missing owner email', {
          organizationId: org.organizationId,
          organizationName: org.organizationName,
        })
        stats.skipped++
        continue
      }

      await sendTrialDeletionFinalEmail({
        email: org.ownerEmail,
        organizationName: org.organizationName,
        hoursUntilDeletion: 24,
        reactivationLink: `${WEBAPP_URL}/subscription/reactivate/${org.organizationId}`,
      })

      // Update notification status in database
      await db
        .update(schema.PlanSubscription)
        .set({
          lastDeletionNotificationSent: 'FINAL',
          lastDeletionNotificationDate: new Date(),
        })
        .where(eq(schema.PlanSubscription.organizationId, org.organizationId))

      stats.notificationsFinal++
      logger.info('Sent final deletion notice', {
        organizationId: org.organizationId,
        organizationName: org.organizationName,
        ownerEmail: org.ownerEmail,
      })
    } catch (error) {
      logger.error('Failed to send final notice email', {
        organizationId: org.organizationId,
        error,
      })
      stats.errors++
    }
  }
}

/**
 * Process a batch of organizations for deletion
 */
async function processDeletionBatch(
  batch: OrganizationToDelete[],
  dryRun: boolean,
  stats: CleanupStats
) {
  for (const org of batch) {
    try {
      // Double-check organization hasn't been reactivated since job started
      const freshCheck = await db
        .select({ stripeSubscriptionId: schema.PlanSubscription.stripeSubscriptionId })
        .from(schema.PlanSubscription)
        .where(eq(schema.PlanSubscription.organizationId, org.organizationId))
        .limit(1)

      if (freshCheck[0]?.stripeSubscriptionId) {
        logger.info('Organization was reactivated, skipping deletion', {
          organizationId: org.organizationId,
          organizationName: org.organizationName,
        })
        stats.skipped++
        continue
      }

      if (dryRun) {
        const daysSinceExpiry = Math.floor(
          (Date.now() - org.trialEnd.getTime()) / (1000 * 60 * 60 * 24)
        )

        logger.info('[DRY RUN] Would delete organization', {
          organizationId: org.organizationId,
          organizationName: org.organizationName,
          daysSinceExpiry,
          trialConversionStatus: org.trialConversionStatus,
        })
        stats.skipped++
      } else {
        // Use existing comprehensive deletion service
        const orgService = new OrganizationService(db)

        await orgService.deleteOrganization({
          organizationId: org.organizationId,
          skipEmailConfirmation: true, // Already confirmed via grace period
          isSystemDeletion: true, // Mark as automated deletion
        })

        logger.info('Deleted expired trial organization', {
          organizationId: org.organizationId,
          organizationName: org.organizationName,
          daysSinceExpiry: Math.floor(
            (Date.now() - org.trialEnd.getTime()) / (1000 * 60 * 60 * 24)
          ),
        })
        stats.deleted++
      }
    } catch (error) {
      logger.error('Failed to delete organization', {
        organizationId: org.organizationId,
        organizationName: org.organizationName,
        error,
      })
      stats.errors++
    }
  }
}
