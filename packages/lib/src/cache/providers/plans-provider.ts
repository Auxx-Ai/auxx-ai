// packages/lib/src/cache/providers/plans-provider.ts

import { schema } from '@auxx/database'
import { asc, eq } from 'drizzle-orm'
import type { CachedPlan } from '../app-cache-keys'
import type { AppCacheProvider } from '../app-cache-provider'

/** Serializes a plan row to a cache-safe shape */
function serializePlan(plan: typeof schema.Plan.$inferSelect): CachedPlan {
  return {
    id: plan.id,
    name: plan.name,
    description: plan.description,
    features: plan.features,
    monthlyPrice: plan.monthlyPrice,
    annualPrice: plan.annualPrice,
    isCustomPricing: plan.isCustomPricing,
    hasTrial: plan.hasTrial,
    trialDays: plan.trialDays,
    minSeats: plan.minSeats,
    maxSeats: plan.maxSeats,
    isMostPopular: plan.isMostPopular,
    isFree: plan.isFree,
    featureLimits: plan.featureLimits,
    trialFeatureLimits: plan.trialFeatureLimits,
    stripeProductId: plan.stripeProductId,
    stripePriceIdMonthly: plan.stripePriceIdMonthly,
    stripePriceIdAnnual: plan.stripePriceIdAnnual,
    hierarchyLevel: plan.hierarchyLevel,
    selfServed: plan.selfServed,
  }
}

export { serializePlan }

/** Computes all non-legacy plans ordered by hierarchy level */
export const plansProvider: AppCacheProvider<CachedPlan[]> = {
  async compute(db) {
    const plans = await db
      .select()
      .from(schema.Plan)
      .where(eq(schema.Plan.isLegacy, false))
      .orderBy(asc(schema.Plan.hierarchyLevel))

    return plans.map(serializePlan)
  },
}
