// packages/lib/src/jobs/billing/stripe-subscription-sync-job.ts

import type { Job } from 'bullmq'
import { z } from 'zod'
import { createScopedLogger } from '../../logger'
import { database as db, schema } from '@auxx/database'
import { and, isNotNull, inArray, eq } from 'drizzle-orm'
import { stripeClient } from '@auxx/billing'

const logger = createScopedLogger('stripe-subscription-sync-job')

/**
 * Job payload schema
 */
const payloadSchema = z.object({
  batchSize: z.number().int().positive().default(50),
  dryRun: z.boolean().default(false),
})

/** Payload for syncing Stripe subscriptions */
export type StripeSubscriptionSyncJobData = z.infer<typeof payloadSchema>

/**
 * Result of syncing Stripe subscriptions
 */
export interface StripeSubscriptionSyncResult {
  total: number
  synced: number
  upToDate: number
  errors: number
  discrepancies: Array<{
    subscriptionId: string
    organizationId: string
    field: string
    localValue: unknown
    stripeValue: unknown
  }>
}

/**
 * Syncs local subscription records with Stripe to ensure data integrity.
 * Acts as a backup to webhooks in case events are missed.
 * Detects and fixes trial state transitions that may have been missed.
 */
export async function stripeSubscriptionSyncJob(
  job: Job<StripeSubscriptionSyncJobData>
): Promise<StripeSubscriptionSyncResult> {
  const input = payloadSchema.parse(job.data)

  logger.info('Starting Stripe subscription sync job', {
    jobId: job.id,
    ...input,
  })

  const result: StripeSubscriptionSyncResult = {
    total: 0,
    synced: 0,
    upToDate: 0,
    errors: 0,
    discrepancies: [],
  }

  try {
    // Find active/trialing subscriptions with Stripe IDs
    const subscriptions = await db.query.PlanSubscription.findMany({
      where: and(
        isNotNull(schema.PlanSubscription.stripeSubscriptionId),
        inArray(schema.PlanSubscription.status, ['active', 'trialing', 'past_due'])
      ),
      limit: input.batchSize,
    })

    result.total = subscriptions.length

    if (subscriptions.length === 0) {
      logger.info('No subscriptions to sync')
      return result
    }

    const stripe = stripeClient.getClient()

    for (const sub of subscriptions) {
      try {
        const stripeSub = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId!)
        const firstItem = stripeSub.items.data[0]

        const updates: Partial<typeof schema.PlanSubscription.$inferInsert> = {}
        let needsUpdate = false

        // Check status discrepancy
        if (sub.status !== stripeSub.status) {
          result.discrepancies.push({
            subscriptionId: sub.id,
            organizationId: sub.organizationId,
            field: 'status',
            localValue: sub.status,
            stripeValue: stripeSub.status,
          })
          updates.status = stripeSub.status
          needsUpdate = true

          // Detect trial transitions that may have been missed
          if (sub.status === 'trialing' && stripeSub.status === 'active') {
            updates.hasTrialEnded = true
            updates.trialConversionStatus = 'CONVERTED_TO_PAID'
            updates.isEligibleForTrial = false
            updates.trialEligibilityReason = 'Already converted from trial'

            logger.info('Detected missed trial -> active transition', {
              subscriptionId: sub.id,
              organizationId: sub.organizationId,
            })
          }

          if (sub.status === 'trialing' && stripeSub.status === 'canceled') {
            updates.hasTrialEnded = true
            updates.trialConversionStatus = 'EXPIRED_WITHOUT_CONVERSION'
            updates.isEligibleForTrial = false
            updates.trialEligibilityReason = 'Trial expired without conversion'

            logger.info('Detected missed trial -> canceled transition', {
              subscriptionId: sub.id,
              organizationId: sub.organizationId,
            })
          }

          if (sub.status === 'trialing' && stripeSub.status === 'past_due') {
            updates.hasTrialEnded = true
            updates.trialConversionStatus = 'EXPIRED_WITHOUT_CONVERSION'
            updates.isEligibleForTrial = false
            updates.trialEligibilityReason = 'Trial ended with payment failure'

            logger.info('Detected missed trial -> past_due transition', {
              subscriptionId: sub.id,
              organizationId: sub.organizationId,
            })
          }
        }

        // Check period dates
        if (firstItem) {
          const periodEnd = new Date(firstItem.current_period_end * 1000)
          const periodStart = new Date(firstItem.current_period_start * 1000)

          if (sub.periodEnd?.getTime() !== periodEnd.getTime()) {
            result.discrepancies.push({
              subscriptionId: sub.id,
              organizationId: sub.organizationId,
              field: 'periodEnd',
              localValue: sub.periodEnd?.toISOString(),
              stripeValue: periodEnd.toISOString(),
            })
            updates.periodEnd = periodEnd
            updates.periodStart = periodStart
            needsUpdate = true
          }
        }

        // Check cancel status
        if (sub.cancelAtPeriodEnd !== stripeSub.cancel_at_period_end) {
          result.discrepancies.push({
            subscriptionId: sub.id,
            organizationId: sub.organizationId,
            field: 'cancelAtPeriodEnd',
            localValue: sub.cancelAtPeriodEnd,
            stripeValue: stripeSub.cancel_at_period_end,
          })
          updates.cancelAtPeriodEnd = stripeSub.cancel_at_period_end
          needsUpdate = true
        }

        // Check trial dates if subscription has trial info in Stripe
        if (stripeSub.trial_start && stripeSub.trial_end) {
          const trialStart = new Date(stripeSub.trial_start * 1000)
          const trialEnd = new Date(stripeSub.trial_end * 1000)

          if (!sub.trialStart || sub.trialStart.getTime() !== trialStart.getTime()) {
            updates.trialStart = trialStart
            needsUpdate = true
          }

          if (!sub.trialEnd || sub.trialEnd.getTime() !== trialEnd.getTime()) {
            updates.trialEnd = trialEnd
            needsUpdate = true
          }

          // Mark trial as used if not already
          if (sub.isEligibleForTrial !== false) {
            updates.isEligibleForTrial = false
            updates.trialEligibilityReason = 'Trial already used'
            needsUpdate = true
          }

          // Check if trial has ended but hasTrialEnded is not set
          const now = new Date()
          if (trialEnd <= now && !sub.hasTrialEnded) {
            updates.hasTrialEnded = true
            needsUpdate = true
          }
        }

        if (needsUpdate && !input.dryRun) {
          updates.updatedAt = new Date()
          await db
            .update(schema.PlanSubscription)
            .set(updates)
            .where(eq(schema.PlanSubscription.id, sub.id))

          logger.info('Synced subscription with Stripe', {
            subscriptionId: sub.id,
            organizationId: sub.organizationId,
            changes: Object.keys(updates),
          })
          result.synced++
        } else if (needsUpdate && input.dryRun) {
          logger.info('[DRY RUN] Would sync subscription', {
            subscriptionId: sub.id,
            changes: Object.keys(updates),
          })
          result.synced++
        } else {
          result.upToDate++
        }

        // Update job progress
        const processed = result.synced + result.upToDate + result.errors
        const progress = Math.round((processed / result.total) * 100)
        await job.updateProgress(progress)
      } catch (error) {
        logger.error('Failed to sync subscription', {
          subscriptionId: sub.id,
          error: error instanceof Error ? error.message : String(error),
        })
        result.errors++
      }
    }

    await job.updateProgress(100)

    logger.info('Stripe subscription sync job completed', {
      jobId: job.id,
      ...result,
      discrepancyCount: result.discrepancies.length,
    })

    return result
  } catch (error) {
    logger.error('Stripe subscription sync job failed', {
      error: error instanceof Error ? error.message : String(error),
      jobId: job.id,
    })
    throw error
  }
}
