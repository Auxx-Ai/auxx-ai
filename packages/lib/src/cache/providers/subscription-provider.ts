// packages/lib/src/cache/providers/subscription-provider.ts

import { schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import type { DehydratedSubscription } from '../org-cache-keys'
import type { CacheProvider } from '../org-cache-provider'

/** Computes the dehydrated subscription for an organization */
export const subscriptionProvider: CacheProvider<DehydratedSubscription | null> = {
  async compute(orgId, db) {
    const [subscription] = await db
      .select()
      .from(schema.PlanSubscription)
      .where(eq(schema.PlanSubscription.organizationId, orgId))
      .limit(1)

    if (!subscription) return null

    return {
      id: subscription.id,
      status: subscription.status,
      plan: subscription.plan,
      planId: subscription.planId,
      seats: subscription.seats,
      billingCycle: subscription.billingCycle,
      periodStart: subscription.periodStart?.toISOString() ?? null,
      periodEnd: subscription.periodEnd?.toISOString() ?? null,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      canceledAt: subscription.canceledAt?.toISOString() ?? null,
      trialStart: subscription.trialStart?.toISOString() ?? null,
      trialEnd: subscription.trialEnd?.toISOString() ?? null,
      hasTrialEnded: subscription.hasTrialEnded,
      isEligibleForTrial: subscription.isEligibleForTrial,
      scheduledPlanId: subscription.scheduledPlanId,
      scheduledPlan: subscription.scheduledPlan,
      scheduledBillingCycle: subscription.scheduledBillingCycle,
      scheduledSeats: subscription.scheduledSeats,
      scheduledChangeAt: subscription.scheduledChangeAt?.toISOString() ?? null,
    }
  },
}
