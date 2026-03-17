// packages/billing/src/hooks/subscription-deleted.ts
/**
 * Webhook handler for subscription deletion.
 */

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { eq } from 'drizzle-orm'
import type Stripe from 'stripe'

/** Scoped structured logger for subscription-deleted webhook events. */
const logger = createScopedLogger('webhook:subscription-deleted')

/**
 * Handles the `customer.subscription.deleted` webhook by synchronizing the local subscription state
 * with Stripe. Retrieves the subscription record via its Stripe identifier, logs if the subscription
 * does not exist locally, and marks any matching record as canceled. Re-throws unexpected failures so
 * upstream processors can apply their retry or alert logic.
 *
 * @param db - Drizzle database client used to locate and update local subscription records.
 * @param event - Raw Stripe event emitted for subscription deletion; must contain a `Stripe.Subscription` payload.
 * @returns Promise that resolves once the local subscription (if found) is marked as canceled.
 * @throws Error when database interactions or input parsing fails, allowing the caller to handle retries.
 */
export async function handleSubscriptionDeleted(
  db: Database,
  event: Stripe.Event
): Promise<{ organizationId: string | null }> {
  try {
    const subscriptionDeleted = event.data.object as Stripe.Subscription
    const subscriptionId = subscriptionDeleted.id

    // Find local subscription
    const subscription = await db.query.PlanSubscription.findFirst({
      where: (sub, { eq }) => eq(sub.stripeSubscriptionId, subscriptionId),
    })

    if (!subscription) {
      logger.warn('Subscription not found in database', {
        stripeSubscriptionId: subscriptionId,
      })
      return { organizationId: null }
    }

    // Mark as canceled
    await db
      .update(schema.PlanSubscription)
      .set({
        status: 'canceled',
        canceledAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.PlanSubscription.id, subscription.id))

    logger.info('Subscription deleted', {
      subscriptionId: subscription.id,
    })

    return { organizationId: subscription.organizationId }
  } catch (error: any) {
    logger.error('Stripe webhook failed in subscription deletion', { error: error.message })
    throw error
  }
}
