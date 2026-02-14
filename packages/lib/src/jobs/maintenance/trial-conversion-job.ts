// packages/lib/src/jobs/maintenance/trial-conversion-job.ts

import { WEBAPP_URL } from '@auxx/config/server'
import { database as db, schema } from '@auxx/database'
import { sendTrialConversionEmail } from '@auxx/email'
import { createScopedLogger } from '@auxx/logger'
import type { Job } from 'bullmq'
import { addDays, format } from 'date-fns'
import { and, eq, gte, isNull, lte } from 'drizzle-orm'
import { z } from 'zod'

const payloadSchema = z.object({
  dryRun: z.boolean().default(false),
  batchSize: z.number().int().positive().default(50),
  daysBeforeEnd: z.number().int().positive().default(3), // Send 3 days before trial ends
})

const logger = createScopedLogger('trial-conversion-email-job')

/**
 * Statistics tracking for the trial conversion email job
 */
export interface TrialConversionStats {
  scanned: number
  sent: number
  skipped: number
  errors: number
}

/**
 * Job handler to send trial conversion emails to users nearing trial end.
 * Sends email 3 days before trial expires to encourage conversion.
 * Runs daily at 10 AM.
 */
export const sendTrialConversionEmailsJob = async (job: Job) => {
  const input = payloadSchema.parse(job.data)
  const stats: TrialConversionStats = {
    scanned: 0,
    sent: 0,
    skipped: 0,
    errors: 0,
  }

  logger.info('Starting trial conversion email job', {
    jobId: job.id,
    dryRun: input.dryRun,
    daysBeforeEnd: input.daysBeforeEnd,
  })

  try {
    // Find users whose trial ends in 3 days (with 1-day buffer)
    const now = new Date()
    const targetEndDate = addDays(now, input.daysBeforeEnd)
    const oneDayBefore = addDays(targetEndDate, -1)
    const oneDayAfter = addDays(targetEndDate, 1)

    const eligibleOrgs = await db
      .select({
        organizationId: schema.Organization.id,
        organizationName: schema.Organization.name,
        ownerEmail: schema.User.email,
        ownerName: schema.User.name,
        trialEnd: schema.PlanSubscription.trialEnd,
      })
      .from(schema.PlanSubscription)
      .innerJoin(
        schema.Organization,
        eq(schema.Organization.id, schema.PlanSubscription.organizationId)
      )
      .innerJoin(schema.User, eq(schema.User.id, schema.Organization.createdById))
      .where(
        and(
          // Trial ends in ~3 days (with 1-day buffer)
          gte(schema.PlanSubscription.trialEnd, oneDayBefore),
          lte(schema.PlanSubscription.trialEnd, oneDayAfter),
          // Trial not ended yet
          eq(schema.PlanSubscription.hasTrialEnded, false),
          // No active subscription
          isNull(schema.PlanSubscription.stripeSubscriptionId)
        )
      )
      .limit(input.batchSize)

    stats.scanned = eligibleOrgs.length

    logger.info('Found eligible organizations for trial conversion email', {
      count: eligibleOrgs.length,
    })

    // Send emails
    for (const org of eligibleOrgs) {
      try {
        if (!org.ownerEmail) {
          logger.warn('Skipping organization with missing owner email', {
            organizationId: org.organizationId,
            organizationName: org.organizationName,
          })
          stats.skipped++
          continue
        }

        if (input.dryRun) {
          logger.info('[DRY RUN] Would send trial conversion email', {
            organizationId: org.organizationId,
            organizationName: org.organizationName,
            ownerEmail: org.ownerEmail,
          })
          stats.skipped++
        } else {
          // Format trial end date
          const trialEndDate = org.trialEnd
            ? format(org.trialEnd, 'MMMM d, yyyy')
            : format(targetEndDate, 'MMMM d, yyyy')

          // TODO: Fetch actual usage metrics from database
          // For now using placeholder values
          const totalTicketsResolved = 0
          const totalTimeSaved = 0

          // Send trial conversion email
          await sendTrialConversionEmail({
            email: org.ownerEmail,
            name: org.ownerName || 'there',
            trialEndDate,
            totalTicketsResolved,
            totalTimeSaved,
            recommendedPlan: 'Growth',
            monthlyPrice: 99,
            billingUrl: `${WEBAPP_URL}/settings/billing`,
            daysBeforeEnd: input.daysBeforeEnd,
          })

          logger.info('Sent trial conversion email', {
            organizationId: org.organizationId,
            organizationName: org.organizationName,
            ownerEmail: org.ownerEmail,
            trialEndDate,
          })
          stats.sent++
        }
      } catch (error) {
        logger.error('Failed to send trial conversion email', {
          organizationId: org.organizationId,
          organizationName: org.organizationName,
          error,
        })
        stats.errors++
      }
    }

    logger.info('Trial conversion email job completed', stats)
    return stats
  } catch (error) {
    logger.error('Failed to complete trial conversion email job', { error })
    throw error
  }
}
