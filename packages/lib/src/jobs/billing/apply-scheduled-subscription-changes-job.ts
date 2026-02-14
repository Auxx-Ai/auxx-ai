// packages/lib/src/jobs/billing/apply-scheduled-subscription-changes-job.ts

import { stripeClient } from '@auxx/billing'
import { database as db, schema } from '@auxx/database'
import type { Job } from 'bullmq'
import { and, eq, inArray, isNotNull, lte } from 'drizzle-orm'
import { z } from 'zod'
import { createScopedLogger } from '../../logger'

const logger = createScopedLogger('apply-scheduled-subscription-changes-job')

/**
 * Job payload schema
 */
const payloadSchema = z.object({
  organizationId: z.string().optional(),
  dryRun: z.boolean().default(false),
  batchSize: z.number().int().positive().default(50),
})

/** Payload for applying scheduled subscription changes */
export type ApplyScheduledChangesJobData = z.infer<typeof payloadSchema>

/**
 * Result of applying scheduled changes
 */
export interface ApplyScheduledChangesResult {
  totalFound: number
  successful: number
  skipped: number
  failed: number
  errors: Array<{
    subscriptionId: string
    organizationId: string
    error: string
  }>
}

/**
 * Find subscriptions with scheduled changes that are past due
 */
async function findScheduledChanges(
  organizationId?: string,
  batchSize: number = 50
): Promise<
  Array<
    typeof schema.PlanSubscription.$inferSelect & {
      plan: typeof schema.Plan.$inferSelect
    }
  >
> {
  const now = new Date()

  const conditions = [
    isNotNull(schema.PlanSubscription.scheduledPlanId),
    isNotNull(schema.PlanSubscription.scheduledChangeAt),
    lte(schema.PlanSubscription.scheduledChangeAt, now),
    inArray(schema.PlanSubscription.status, ['active', 'trialing']),
  ]

  if (organizationId) {
    conditions.push(eq(schema.PlanSubscription.organizationId, organizationId))
  }

  const subscriptions = await db.query.PlanSubscription.findMany({
    where: and(...conditions),
    with: {
      plan: true,
    },
    limit: batchSize,
  })

  logger.info('Found subscriptions with scheduled changes', {
    count: subscriptions.length,
    organizationId,
  })

  return subscriptions
}

/**
 * Validate that scheduled change is still valid and safe to apply
 */
async function validateScheduledChange(
  subscription: typeof schema.PlanSubscription.$inferSelect
): Promise<{ valid: boolean; reason?: string }> {
  // 1. Check subscription is still active
  if (!['active', 'trialing'].includes(subscription.status)) {
    return { valid: false, reason: 'Subscription no longer active' }
  }

  // 2. Check scheduled fields are populated
  if (!subscription.scheduledPlanId || !subscription.scheduledChangeAt) {
    return { valid: false, reason: 'Missing scheduled change fields' }
  }

  // 3. Check scheduled plan exists
  const scheduledPlan = await db.query.Plan.findFirst({
    where: eq(schema.Plan.id, subscription.scheduledPlanId),
  })

  if (!scheduledPlan) {
    return { valid: false, reason: 'Scheduled plan not found' }
  }

  // 4. Check Stripe subscription exists
  if (!subscription.stripeSubscriptionId) {
    return { valid: false, reason: 'Missing Stripe subscription ID' }
  }

  // 5. Check if user cancelled subscription (cancelAtPeriodEnd = true)
  // In this case, skip the downgrade - cancellation takes precedence
  if (subscription.cancelAtPeriodEnd) {
    return { valid: false, reason: 'Subscription is being cancelled' }
  }

  // 6. Verify Stripe subscription is still active
  try {
    const stripe = stripeClient.getClient()
    const stripeSubscription = await stripe.subscriptions.retrieve(
      subscription.stripeSubscriptionId
    )

    if (!['active', 'trialing'].includes(stripeSubscription.status)) {
      return {
        valid: false,
        reason: `Stripe subscription status: ${stripeSubscription.status}`,
      }
    }
  } catch (error) {
    logger.error('Failed to retrieve Stripe subscription', {
      subscriptionId: subscription.id,
      stripeSubscriptionId: subscription.stripeSubscriptionId,
      error: error instanceof Error ? error.message : String(error),
    })
    return { valid: false, reason: 'Failed to verify Stripe subscription' }
  }

  return { valid: true }
}

/**
 * Apply a single scheduled change
 */
async function applyScheduledChange(
  subscription: typeof schema.PlanSubscription.$inferSelect & {
    plan: typeof schema.Plan.$inferSelect
  },
  dryRun: boolean
): Promise<{ success: boolean; error?: string }> {
  const {
    id: subscriptionId,
    organizationId,
    stripeSubscriptionId,
    scheduledPlanId,
    scheduledPlan,
    scheduledBillingCycle,
    scheduledSeats,
  } = subscription

  logger.info('Applying scheduled change', {
    subscriptionId,
    organizationId,
    fromPlan: subscription.plan,
    toPlan: scheduledPlan,
    fromBillingCycle: subscription.billingCycle,
    toBillingCycle: scheduledBillingCycle,
    dryRun,
  })

  if (dryRun) {
    logger.info('[DRY RUN] Would apply scheduled change', {
      subscriptionId,
      scheduledPlan,
    })
    return { success: true }
  }

  try {
    // 1. Get the scheduled plan details
    const targetPlan = await db.query.Plan.findFirst({
      where: eq(schema.Plan.id, scheduledPlanId!),
    })

    if (!targetPlan) {
      throw new Error('Target plan not found')
    }

    // 2. Get Stripe price ID for new plan
    const priceId =
      scheduledBillingCycle === 'ANNUAL'
        ? targetPlan.stripePriceIdAnnual
        : targetPlan.stripePriceIdMonthly

    if (!priceId) {
      throw new Error(`Price ID not configured for ${scheduledBillingCycle}`)
    }

    // 3. Update Stripe subscription
    const stripe = stripeClient.getClient()
    const stripeSubscription = await stripe.subscriptions.retrieve(stripeSubscriptionId!)
    const subscriptionItemId = stripeSubscription.items.data[0]?.id

    if (!subscriptionItemId) {
      throw new Error('No subscription items found')
    }

    // Update Stripe - no proration since change is scheduled at renewal
    await stripe.subscriptions.update(stripeSubscriptionId!, {
      items: [
        {
          id: subscriptionItemId,
          price: priceId,
          quantity: scheduledSeats ?? subscription.seats,
        },
      ],
      proration_behavior: 'none', // No charge - change happens at renewal
      billing_cycle_anchor: 'unchanged',
    })

    // 4. Update database - apply scheduled change and clear scheduled fields
    await db
      .update(schema.PlanSubscription)
      .set({
        planId: scheduledPlanId,
        plan: scheduledPlan!,
        billingCycle: scheduledBillingCycle ?? subscription.billingCycle,
        seats: scheduledSeats ?? subscription.seats,
        // Clear scheduled fields
        scheduledPlanId: null,
        scheduledPlan: null,
        scheduledBillingCycle: null,
        scheduledSeats: null,
        scheduledChangeAt: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.PlanSubscription.id, subscriptionId))

    logger.info('Successfully applied scheduled change', {
      subscriptionId,
      organizationId,
      newPlan: scheduledPlan,
    })

    return { success: true }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)

    logger.error('Failed to apply scheduled change', {
      subscriptionId,
      organizationId,
      error: errorMessage,
    })

    return { success: false, error: errorMessage }
  }
}

/**
 * Cronjob that applies pending subscription plan changes at their scheduled date.
 * Runs every hour as backup to Stripe webhooks.
 */
export async function applyScheduledSubscriptionChangesJob(
  job: Job<ApplyScheduledChangesJobData>
): Promise<ApplyScheduledChangesResult> {
  const input = payloadSchema.parse(job.data)

  logger.info('Starting scheduled subscription changes job', {
    jobId: job.id,
    ...input,
  })

  const result: ApplyScheduledChangesResult = {
    totalFound: 0,
    successful: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  }

  try {
    // Find subscriptions with scheduled changes
    const subscriptions = await findScheduledChanges(input.organizationId, input.batchSize)

    result.totalFound = subscriptions.length

    if (subscriptions.length === 0) {
      logger.info('No scheduled changes to apply')
      return result
    }

    // Process each subscription
    for (const subscription of subscriptions) {
      try {
        // Validate change is still valid
        const validation = await validateScheduledChange(subscription)

        if (!validation.valid) {
          logger.info('Skipping scheduled change', {
            subscriptionId: subscription.id,
            reason: validation.reason,
          })
          result.skipped++
          continue
        }

        // Apply the change
        const applyResult = await applyScheduledChange(subscription, input.dryRun)

        if (applyResult.success) {
          result.successful++
        } else {
          result.failed++
          result.errors.push({
            subscriptionId: subscription.id,
            organizationId: subscription.organizationId,
            error: applyResult.error || 'Unknown error',
          })
        }

        // Update job progress
        const progress = Math.round(
          ((result.successful + result.skipped + result.failed) / result.totalFound) * 100
        )
        await job.updateProgress(progress)
      } catch (error) {
        logger.error('Unexpected error processing subscription', {
          subscriptionId: subscription.id,
          error: error instanceof Error ? error.message : String(error),
        })
        result.failed++
        result.errors.push({
          subscriptionId: subscription.id,
          organizationId: subscription.organizationId,
          error: error instanceof Error ? error.message : 'Unexpected error',
        })
      }
    }

    await job.updateProgress(100)

    logger.info('Scheduled subscription changes job completed', {
      jobId: job.id,
      ...result,
    })

    return result
  } catch (error) {
    logger.error('Scheduled subscription changes job failed', {
      error: error instanceof Error ? error.message : String(error),
      jobId: job.id,
    })
    throw error
  }
}
