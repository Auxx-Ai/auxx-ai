// packages/lib/src/cache/providers/subscription-provider.ts

import { schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import type { CachedSubscription } from '../org-cache-keys'
import type { CacheProvider } from '../org-cache-provider'

/** Computes the full cached subscription for an organization */
export const subscriptionProvider: CacheProvider<CachedSubscription | null> = {
  async compute(orgId, db) {
    const [subscription] = await db
      .select()
      .from(schema.PlanSubscription)
      .where(eq(schema.PlanSubscription.organizationId, orgId))
      .limit(1)

    if (!subscription) return null

    return {
      id: subscription.id,
      organizationId: subscription.organizationId,
      status: subscription.status,
      plan: subscription.plan,
      planId: subscription.planId,
      seats: subscription.seats,
      billingCycle: subscription.billingCycle,
      periodStart: subscription.periodStart?.toISOString() ?? null,
      periodEnd: subscription.periodEnd?.toISOString() ?? null,
      endDate: subscription.endDate?.toISOString() ?? null,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      canceledAt: subscription.canceledAt?.toISOString() ?? null,
      creditsBalance: subscription.creditsBalance,

      stripeCustomerId: subscription.stripeCustomerId,
      stripeSubscriptionId: subscription.stripeSubscriptionId,

      trialStart: subscription.trialStart?.toISOString() ?? null,
      trialEnd: subscription.trialEnd?.toISOString() ?? null,
      hasTrialEnded: subscription.hasTrialEnded,
      trialConversionStatus: subscription.trialConversionStatus,
      isEligibleForTrial: subscription.isEligibleForTrial,
      trialEligibilityReason: subscription.trialEligibilityReason,

      scheduledPlanId: subscription.scheduledPlanId,
      scheduledPlan: subscription.scheduledPlan,
      scheduledBillingCycle: subscription.scheduledBillingCycle,
      scheduledSeats: subscription.scheduledSeats,
      scheduledChangeAt: subscription.scheduledChangeAt?.toISOString() ?? null,

      lastDeletionNotificationSent: subscription.lastDeletionNotificationSent,
      lastDeletionNotificationDate:
        subscription.lastDeletionNotificationDate?.toISOString() ?? null,
      deletionScheduledDate: subscription.deletionScheduledDate?.toISOString() ?? null,
      deletionReason: subscription.deletionReason,

      customFeatureLimits: subscription.customFeatureLimits,
      customPricingMonthly: subscription.customPricingMonthly,
      customPricingAnnual: subscription.customPricingAnnual,
      customPricingNotes: subscription.customPricingNotes,
    }
  },
}
