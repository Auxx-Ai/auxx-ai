// packages/billing/src/hooks/subscription-updated.ts
/**
 * Webhook handler for subscription updates.
 */

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { handlePlanDowngrade } from '@auxx/lib/permissions'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, or } from 'drizzle-orm'
import type Stripe from 'stripe'

/**
 * Scoped logger used to emit structured subscription synchronization events.
 */
const logger = createScopedLogger('webhook:subscription-sync')

/**
 * Synchronizes the incoming Stripe subscription payload with the local `PlanSubscription` record.
 *
 * Resolves the subscription's plan by attempting to match the Stripe price identifier or lookup key
 * against the active plans stored in the database. If an existing local subscription is not found by
 * the Stripe metadata identifiers, the handler progressively falls back to searching by Stripe IDs and
 * organization references before updating the local record with the latest lifecycle details.
 *
 * @param db Database client used for Drizzle ORM queries and updates
 * @param stripeSubscription Raw subscription object received from the Stripe webhook payload
 * @param eventType Stripe webhook event type currently being processed (e.g., `customer.subscription.updated`)
 * @returns Promise that resolves once the local subscription record has been upserted with remote changes
 */
async function syncStripeSubscription(
  db: Database,
  stripeSubscription: Stripe.Subscription,
  eventType: string
): Promise<void> {
  const firstItem = stripeSubscription.items.data.at(0)
  const priceId = firstItem?.price.id ?? null
  const priceLookupKey = firstItem?.price.lookup_key ?? null

  let plan: typeof schema.Plan.$inferSelect | undefined

  if (priceId || priceLookupKey) {
    plan = await db.query.Plan.findFirst({
      where: (p, helpers) =>
        and(
          helpers.eq(p.isLegacy, false),
          or(
            priceId ? helpers.eq(p.stripePriceIdMonthly, priceId) : undefined,
            priceId ? helpers.eq(p.stripePriceIdAnnual, priceId) : undefined,
            priceLookupKey ? helpers.eq(p.stripePriceIdMonthly, priceLookupKey) : undefined,
            priceLookupKey ? helpers.eq(p.stripePriceIdAnnual, priceLookupKey) : undefined
          )
        ),
    })
  } else {
    logger.warn('Missing price information on subscription item', {
      eventType,
      stripeSubscriptionId: stripeSubscription.id,
    })
  }

  if (!plan) {
    logger.warn('Plan not found for subscription price', {
      eventType,
      priceId,
      priceLookupKey,
    })
  }

  const subscriptionId = stripeSubscription.metadata?.subscriptionId ?? null
  const organizationId = stripeSubscription.metadata?.organizationId ?? null
  const customerId =
    typeof stripeSubscription.customer === 'string'
      ? stripeSubscription.customer
      : (stripeSubscription.customer?.id ?? null)

  let localSubscription = subscriptionId
    ? await db.query.PlanSubscription.findFirst({
        where: (sub, helpers) => helpers.eq(sub.id, subscriptionId),
      })
    : null

  if (!localSubscription) {
    localSubscription = await db.query.PlanSubscription.findFirst({
      where: (sub, helpers) => helpers.eq(sub.stripeSubscriptionId, stripeSubscription.id),
    })
  }

  if (!localSubscription && customerId) {
    const subs = await db.query.PlanSubscription.findMany({
      where: (sub, helpers) => helpers.eq(sub.stripeCustomerId, customerId),
    })

    if (subs.length > 1) {
      // If we have organizationId from metadata, use it to find the correct subscription
      // This prevents updating the wrong org's subscription when customer ID is shared
      if (organizationId) {
        const orgMatch = subs.find((s) => s.organizationId === organizationId)
        if (orgMatch) {
          localSubscription = orgMatch
        } else {
          logger.warn('No subscription found matching organizationId from metadata', {
            eventType,
            customerId,
            organizationId,
            foundOrgIds: subs.map((s) => s.organizationId),
          })
          // Don't fall back to wrong org - return early
          return
        }
      } else {
        const preferred = subs.find((s) => s.status === 'active' || s.status === 'trialing')
        localSubscription = preferred ?? subs[0] ?? null

        if (!preferred) {
          logger.warn('Multiple subscriptions found for customer, using first result', {
            eventType,
            customerId,
          })
        }
      }
    } else {
      localSubscription = subs[0] ?? null
    }
  }

  if (!localSubscription && organizationId) {
    const subs = await db.query.PlanSubscription.findMany({
      where: (sub, helpers) => helpers.eq(sub.organizationId, organizationId),
    })

    localSubscription =
      subs.find((s) => s.status === 'active' || s.status === 'trialing') ??
      subs.find((s) => s.status === 'incomplete') ??
      subs.at(0) ??
      null
  }

  if (!localSubscription) {
    logger.warn('Subscription not found in database', {
      eventType,
      stripeSubscriptionId: stripeSubscription.id,
      customerId,
      organizationId,
      subscriptionId,
    })
    return
  }

  const periodStart = firstItem?.current_period_start
  const periodEnd = firstItem?.current_period_end

  if (!periodStart || !periodEnd) {
    logger.warn('Missing period information from subscription', {
      eventType,
      stripeSubscriptionId: stripeSubscription.id,
    })
  }

  // Check if scheduled change should be applied
  const now = new Date()
  const shouldApplyScheduledChange =
    localSubscription.scheduledPlanId &&
    localSubscription.scheduledChangeAt &&
    now >= localSubscription.scheduledChangeAt

  if (shouldApplyScheduledChange) {
    logger.info('Applying scheduled plan change', {
      subscriptionId: localSubscription.id,
      fromPlan: localSubscription.plan,
      toPlan: localSubscription.scheduledPlan,
    })
  }

  // Detect trial state transitions
  const wasTrialing = localSubscription.status === 'trialing'
  const isNowActive = stripeSubscription.status === 'active'
  const isNowCanceled = stripeSubscription.status === 'canceled'
  const isNowPastDue = stripeSubscription.status === 'past_due'

  const updatePayload: Partial<typeof schema.PlanSubscription.$inferInsert> = {
    status: stripeSubscription.status,
    stripeSubscriptionId: stripeSubscription.id,
    seats: shouldApplyScheduledChange
      ? (localSubscription.scheduledSeats ?? firstItem?.quantity ?? 1)
      : (firstItem?.quantity ?? 1),
    cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end ?? false,
    updatedAt: new Date(),
    // Clear scheduled change fields if applying
    scheduledPlanId: shouldApplyScheduledChange ? null : localSubscription.scheduledPlanId,
    scheduledPlan: shouldApplyScheduledChange ? null : localSubscription.scheduledPlan,
    scheduledBillingCycle: shouldApplyScheduledChange
      ? null
      : localSubscription.scheduledBillingCycle,
    scheduledSeats: shouldApplyScheduledChange ? null : localSubscription.scheduledSeats,
    scheduledChangeAt: shouldApplyScheduledChange ? null : localSubscription.scheduledChangeAt,
  }

  // Handle trial -> active transition (converted to paid)
  if (wasTrialing && isNowActive) {
    updatePayload.hasTrialEnded = true
    updatePayload.trialConversionStatus = 'CONVERTED_TO_PAID'
    updatePayload.isEligibleForTrial = false
    updatePayload.trialEligibilityReason = 'Already converted from trial'

    logger.info('Trial converted to paid subscription', {
      subscriptionId: localSubscription.id,
      organizationId: localSubscription.organizationId,
    })
  }

  // Handle trial -> canceled transition (expired without conversion)
  if (wasTrialing && isNowCanceled) {
    updatePayload.hasTrialEnded = true
    updatePayload.trialConversionStatus = 'EXPIRED_WITHOUT_CONVERSION'
    updatePayload.isEligibleForTrial = false
    updatePayload.trialEligibilityReason = 'Trial expired without conversion'

    logger.info('Trial expired without conversion', {
      subscriptionId: localSubscription.id,
      organizationId: localSubscription.organizationId,
    })
  }

  // Handle trial -> past_due transition (payment failed)
  if (wasTrialing && isNowPastDue) {
    updatePayload.hasTrialEnded = true
    updatePayload.trialConversionStatus = 'EXPIRED_WITHOUT_CONVERSION'
    updatePayload.isEligibleForTrial = false
    updatePayload.trialEligibilityReason = 'Trial ended with payment failure'

    logger.info('Trial ended with payment failure', {
      subscriptionId: localSubscription.id,
      organizationId: localSubscription.organizationId,
    })
  }

  // Apply scheduled plan if change is due, otherwise use detected plan from price
  if (shouldApplyScheduledChange && localSubscription.scheduledPlanId) {
    updatePayload.plan = localSubscription.scheduledPlan!
    updatePayload.planId = localSubscription.scheduledPlanId
    updatePayload.billingCycle = localSubscription.scheduledBillingCycle!
  } else if (plan) {
    updatePayload.plan = plan.name.toLowerCase()
    updatePayload.planId = plan.id
  }

  if (customerId) {
    updatePayload.stripeCustomerId = customerId
  }

  if (periodStart) {
    updatePayload.periodStart = new Date(periodStart * 1000)
  }

  if (periodEnd) {
    updatePayload.periodEnd = new Date(periodEnd * 1000)
  }

  if (stripeSubscription.trial_start && stripeSubscription.trial_end) {
    updatePayload.trialStart = new Date(stripeSubscription.trial_start * 1000)
    updatePayload.trialEnd = new Date(stripeSubscription.trial_end * 1000)
  }

  await db
    .update(schema.PlanSubscription)
    .set(updatePayload)
    .where(eq(schema.PlanSubscription.id, localSubscription.id))

  logger.info('Subscription synchronized', {
    eventType,
    subscriptionId: localSubscription.id,
    plan: plan?.name,
    status: stripeSubscription.status,
    cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
  })

  // Detect overages if plan changed (downgrade or trial expiry)
  const newPlanId = updatePayload.planId ?? localSubscription.planId
  if (newPlanId) {
    const oldPlanId = localSubscription.planId
    const planChanged = oldPlanId !== newPlanId || wasTrialing

    if (planChanged) {
      // Compare hierarchy levels to determine if this is a downgrade
      const [oldPlan, newPlan] = await Promise.all([
        oldPlanId
          ? db.query.Plan.findFirst({
              where: (p, { eq }) => eq(p.id, oldPlanId),
              columns: { hierarchyLevel: true },
            })
          : null,
        db.query.Plan.findFirst({
          where: (p, { eq }) => eq(p.id, newPlanId),
          columns: { hierarchyLevel: true },
        }),
      ])

      const isDowngrade =
        wasTrialing || // Trial expiry always checks overages
        (oldPlan && newPlan && newPlan.hierarchyLevel < oldPlan.hierarchyLevel)

      if (isDowngrade) {
        await handlePlanDowngrade(db, localSubscription.organizationId, newPlanId)
      }
    }
  }
}

/**
 * Extracts the Stripe subscription payload from the webhook event and delegates synchronization.
 *
 * Wraps the synchronization call in a try/catch so failures can be logged with contextual metadata and
 * rethrown to surface to the calling middleware, ensuring that transient issues can trigger retries.
 *
 * @param db Database client used to persist subscription state
 * @param event Stripe event envelope containing the subscription object in `data.object`
 * @param eventType Narrowed webhook event type for downstream logging and branching
 * @returns Promise that resolves once the event-specific synchronization is complete
 * @throws Rethrows any error produced by `syncStripeSubscription` to allow upstream retry handling
 */
async function processSubscriptionWebhook(
  db: Database,
  event: Stripe.Event,
  eventType: 'customer.subscription.updated' | 'customer.subscription.created'
): Promise<void> {
  try {
    const stripeSubscription = event.data.object as Stripe.Subscription
    await syncStripeSubscription(db, stripeSubscription, eventType)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : ''
    logger.error('Stripe webhook subscription sync failed', {
      eventType,
      error: message,
    })
    throw error
  }
}

/**
 * Public webhook entry point for handling `customer.subscription.updated` events emitted by Stripe.
 *
 * @param db Database client used to synchronize the subscription with the local data store
 * @param event Stripe webhook event that encapsulates the updated subscription payload
 * @returns Promise that resolves once the subscription has been brought up to date locally
 */
export async function handleSubscriptionUpdated(db: Database, event: Stripe.Event): Promise<void> {
  await processSubscriptionWebhook(db, event, 'customer.subscription.updated')
}

/**
 * Public webhook entry point for handling `customer.subscription.created` events emitted by Stripe.
 *
 * @param db Database client used to synchronize the subscription with the local data store
 * @param event Stripe webhook event that encapsulates the newly created subscription payload
 * @returns Promise that resolves once the subscription creation has been mirrored locally
 */
export async function handleSubscriptionCreated(db: Database, event: Stripe.Event): Promise<void> {
  await processSubscriptionWebhook(db, event, 'customer.subscription.created')
}
