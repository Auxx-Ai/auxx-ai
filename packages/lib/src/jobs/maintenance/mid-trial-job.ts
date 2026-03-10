// packages/lib/src/jobs/maintenance/mid-trial-job.ts

import { WEBAPP_URL } from '@auxx/config/server'
import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { Job } from 'bullmq'
import { addDays } from 'date-fns'
import { and, eq, gte, isNull, lte } from 'drizzle-orm'
import { z } from 'zod'
import { enqueueEmailJob } from '../email'

const payloadSchema = z.object({
  dryRun: z.boolean().default(false),
  batchSize: z.number().int().positive().default(50),
  midTrialDay: z.number().int().positive().default(7), // Day 7 of trial
})

const logger = createScopedLogger('mid-trial-email-job')

/**
 * Statistics tracking for the mid-trial email job
 */
export interface MidTrialStats {
  scanned: number
  sent: number
  skipped: number
  errors: number
}

/**
 * Job handler to send mid-trial engagement emails.
 * Sends email at the midpoint of the trial (day 7 of 14).
 * Runs daily at 10 AM.
 */
export const sendMidTrialEmailsJob = async (job: Job) => {
  const input = payloadSchema.parse(job.data)
  const stats: MidTrialStats = {
    scanned: 0,
    sent: 0,
    skipped: 0,
    errors: 0,
  }

  logger.info('Starting mid-trial email job', {
    jobId: job.id,
    dryRun: input.dryRun,
    midTrialDay: input.midTrialDay,
  })

  try {
    // Find users who are on day 7 of their trial (started 7 days ago)
    const now = new Date()
    const midTrialDate = addDays(now, -input.midTrialDay)
    const oneDayBefore = addDays(midTrialDate, -1)
    const oneDayAfter = addDays(midTrialDate, 1)

    const eligibleOrgs = await db
      .select({
        organizationId: schema.Organization.id,
        organizationName: schema.Organization.name,
        ownerEmail: schema.User.email,
        ownerName: schema.User.name,
        trialStart: schema.PlanSubscription.trialStart,
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
          // Trial started around 7 days ago (with 1-day buffer)
          gte(schema.PlanSubscription.trialStart, oneDayBefore),
          lte(schema.PlanSubscription.trialStart, oneDayAfter),
          // Trial not ended yet
          eq(schema.PlanSubscription.hasTrialEnded, false),
          // No active subscription
          isNull(schema.PlanSubscription.stripeSubscriptionId)
        )
      )
      .limit(input.batchSize)

    stats.scanned = eligibleOrgs.length

    logger.info('Found eligible organizations for mid-trial email', {
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
          logger.info('[DRY RUN] Would send mid-trial email', {
            organizationId: org.organizationId,
            organizationName: org.organizationName,
            ownerEmail: org.ownerEmail,
          })
          stats.skipped++
        } else {
          // Calculate days remaining
          const daysRemaining = org.trialEnd
            ? Math.ceil((org.trialEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
            : 7

          // Send mid-trial email
          await enqueueEmailJob('mid-trial', {
            recipient: { email: org.ownerEmail, name: org.ownerName || 'there' },
            organizationName: org.organizationName,
            daysRemaining,
            dashboardUrl: `${WEBAPP_URL}/dashboard`,
            integrationsUrl: `${WEBAPP_URL}/settings/channels`,
            upgradeUrl: `${WEBAPP_URL}/settings/billing`,
            supportUrl: `${WEBAPP_URL}/support`,
            source: 'mid-trial-job',
            organizationId: org.organizationId,
          })

          logger.info('Sent mid-trial email', {
            organizationId: org.organizationId,
            organizationName: org.organizationName,
            ownerEmail: org.ownerEmail,
            daysRemaining,
          })
          stats.sent++
        }
      } catch (error) {
        logger.error('Failed to send mid-trial email', {
          organizationId: org.organizationId,
          organizationName: org.organizationName,
          error,
        })
        stats.errors++
      }
    }

    logger.info('Mid-trial email job completed', stats)
    return stats
  } catch (error) {
    logger.error('Failed to complete mid-trial email job', { error })
    throw error
  }
}
