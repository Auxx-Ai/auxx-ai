// packages/billing/src/hooks/checkout-session.ts
/**
 * Webhook handler for checkout session completion.
 */

import type Stripe from 'stripe'
import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { eq, and } from 'drizzle-orm'
import { stripeClient } from '../services/stripe-client'
import { createScopedLogger } from '@auxx/logger'

const logger = createScopedLogger('webhook:checkout-session')

export async function handleCheckoutSessionCompleted(
  db: Database,
  event: Stripe.Event
): Promise<void> {
  try {
    const checkoutSession = event.data.object as Stripe.Checkout.Session

    // Skip setup mode sessions
    if (checkoutSession.mode === 'setup') {
      return
    }

    // if (!checkoutSession.subscription) {
    //   logger.warn('Checkout session missing subscription', {
    //     sessionId: checkoutSession.id,
    //   })
    //   return
    // }

    // Fetch full subscription from Stripe
    const subscription = await stripeClient
      .getClient()
      .subscriptions.retrieve(checkoutSession.subscription as string)

    const firstItem = subscription.items.data[0]

    // Get organization and subscription IDs from metadata
    // Check both checkout session metadata and subscription metadata
    const referenceId =
      checkoutSession.client_reference_id ||
      subscription.metadata?.organizationId ||
      checkoutSession.metadata?.organizationId

    const subscriptionId =
      subscription.metadata?.subscriptionId || checkoutSession.metadata?.subscriptionId

    const seats = subscription.items.data[0]?.quantity ?? 1

    if (!referenceId || !subscriptionId) {
      logger.warn('Missing referenceId or subscriptionId in metadata', {
        sessionId: checkoutSession.id,
        referenceId,
        subscriptionId,
        subscriptionMetadata: subscription.metadata,
        sessionMetadata: checkoutSession.metadata,
      })
      return
    }

    // Get price and plan info from subscription
    const priceId = firstItem?.price.id ?? null
    const priceLookupKey = firstItem?.price.lookup_key ?? null

    let plan: typeof schema.Plan.$inferSelect | undefined

    if (priceId || priceLookupKey) {
      plan = await db.query.Plan.findFirst({
        where: (p, { eq, or, and }) =>
          and(
            eq(p.isLegacy, false),
            or(
              priceId ? eq(p.stripePriceIdMonthly, priceId) : undefined,
              priceId ? eq(p.stripePriceIdAnnual, priceId) : undefined,
              priceLookupKey ? eq(p.stripePriceIdMonthly, priceLookupKey) : undefined,
              priceLookupKey ? eq(p.stripePriceIdAnnual, priceLookupKey) : undefined
            )
          ),
      })
    } else {
      logger.warn('Price information missing on subscription item', {
        subscriptionId: subscription.id,
      })
    }

    if (!plan) {
      logger.warn('Plan not found for price', {
        priceId,
        priceLookupKey,
      })
    }

    // Get period info from subscription
    const periodStart = firstItem?.current_period_start
    const periodEnd = firstItem?.current_period_end

    if (!periodStart || !periodEnd) {
      logger.warn('Missing period information from subscription', {
        subscriptionId: subscription.id,
      })
    }

    const customerId =
      typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id

    const updatePayload: Partial<typeof schema.PlanSubscription.$inferInsert> = {
      status: subscription.status,
      stripeSubscriptionId: subscription.id,
      seats,
      cancelAtPeriodEnd: subscription.cancel_at_period_end ?? false,
      updatedAt: new Date(),
    }

    if (plan) {
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

    if (subscription.trial_start && subscription.trial_end) {
      updatePayload.trialStart = new Date(subscription.trial_start * 1000)
      updatePayload.trialEnd = new Date(subscription.trial_end * 1000)

      // Mark trial as used to prevent re-trials
      updatePayload.isEligibleForTrial = false
      updatePayload.trialEligibilityReason = 'Trial already used'

      // Check if trial has already passed
      const now = new Date()
      const trialEndDate = new Date(subscription.trial_end * 1000)
      if (trialEndDate <= now) {
        updatePayload.hasTrialEnded = true
        // Status will determine conversion status in subscription-updated webhook
      }
    }

    await db
      .update(schema.PlanSubscription)
      .set(updatePayload)
      .where(
        and(
          eq(schema.PlanSubscription.id, subscriptionId),
          eq(schema.PlanSubscription.organizationId, referenceId)
        )
      )

    logger.info('Checkout session completed', {
      subscriptionId,
      organizationId: referenceId,
      stripeSubscriptionId: subscription.id,
      plan: plan?.name,
      status: subscription.status,
    })
  } catch (error: any) {
    logger.error('Stripe webhook failed in checkout session', { error: error.message })
    throw error
  }
}
