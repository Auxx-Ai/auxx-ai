// packages/lib/src/jobs/maintenance/getting-started-job.ts

import { WEBAPP_URL } from '@auxx/config/server'
import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { Job } from 'bullmq'
import { addHours } from 'date-fns'
import { and, eq, gte, lte } from 'drizzle-orm'
import { z } from 'zod'
import { enqueueEmailJob } from '../email'

const payloadSchema = z.object({
  dryRun: z.boolean().default(false),
  batchSize: z.number().int().positive().default(50),
})

const logger = createScopedLogger('getting-started-email-job')

/**
 * Statistics tracking for the getting started email job
 */
export interface GettingStartedStats {
  scanned: number
  sent: number
  skipped: number
  errors: number
}

/**
 * Job handler to send getting started emails to new trial users.
 * Sends email 1-2 hours after trial signup.
 * Runs every 30 minutes to catch new signups.
 */
export const sendGettingStartedEmailsJob = async (job: Job) => {
  const input = payloadSchema.parse(job.data)
  const stats: GettingStartedStats = {
    scanned: 0,
    sent: 0,
    skipped: 0,
    errors: 0,
  }

  logger.info('Starting getting started email job', {
    jobId: job.id,
    dryRun: input.dryRun,
  })

  try {
    // Find users who started trial 1-2 hours ago
    const now = new Date()
    const oneHourAgo = addHours(now, -1)
    const twoHoursAgo = addHours(now, -2)

    const eligibleOrgs = await db
      .select({
        organizationId: schema.Organization.id,
        organizationName: schema.Organization.name,
        ownerEmail: schema.User.email,
        ownerName: schema.User.name,
        trialStart: schema.PlanSubscription.trialStart,
      })
      .from(schema.PlanSubscription)
      .innerJoin(
        schema.Organization,
        eq(schema.Organization.id, schema.PlanSubscription.organizationId)
      )
      .innerJoin(schema.User, eq(schema.User.id, schema.Organization.createdById))
      .where(
        and(
          // Trial started between 1-2 hours ago
          gte(schema.PlanSubscription.trialStart, twoHoursAgo),
          lte(schema.PlanSubscription.trialStart, oneHourAgo),
          // Email not sent yet (using custom metadata if added, or just rely on time window)
          eq(schema.PlanSubscription.hasTrialEnded, false)
        )
      )
      .limit(input.batchSize)

    stats.scanned = eligibleOrgs.length

    logger.info('Found eligible organizations for getting started email', {
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
          logger.info('[DRY RUN] Would send getting started email', {
            organizationId: org.organizationId,
            organizationName: org.organizationName,
            ownerEmail: org.ownerEmail,
          })
          stats.skipped++
        } else {
          // Send getting started email
          await enqueueEmailJob('getting-started', {
            recipient: { email: org.ownerEmail, name: org.ownerName || 'there' },
            organizationName: org.organizationName!,
            dashboardUrl: `${WEBAPP_URL}/dashboard`,
            integrationsUrl: `${WEBAPP_URL}/settings/integrations`,
            knowledgeBaseUrl: `${WEBAPP_URL}/knowledge`,
            shopifyUrl: `${WEBAPP_URL}/settings/integrations/shopify`,
            source: 'getting-started-job',
            organizationId: org.organizationId,
          })

          logger.info('Sent getting started email', {
            organizationId: org.organizationId,
            organizationName: org.organizationName,
            ownerEmail: org.ownerEmail,
          })
          stats.sent++
        }
      } catch (error) {
        logger.error('Failed to send getting started email', {
          organizationId: org.organizationId,
          organizationName: org.organizationName,
          error,
        })
        stats.errors++
      }
    }

    logger.info('Getting started email job completed', stats)
    return stats
  } catch (error) {
    logger.error('Failed to complete getting started email job', { error })
    throw error
  }
}
