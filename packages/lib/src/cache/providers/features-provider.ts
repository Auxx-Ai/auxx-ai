// packages/lib/src/cache/providers/features-provider.ts

import { schema } from '@auxx/database'
import { isSelfHosted } from '@auxx/deployment'
import { eq } from 'drizzle-orm'
import { createScopedLogger } from '../../logger'
import type { FeatureDefinition, FeatureLimit, FeatureMapObject } from '../../permissions/types'
import { FeatureKey, parseFeatureLimits } from '../../permissions/types'
import type { CacheProvider } from '../org-cache-provider'
import { getAppCache, getOrgCache } from '../singletons'

const logger = createScopedLogger('features-provider')

/** Computes feature permission map for an organization */
export const featuresProvider: CacheProvider<FeatureMapObject> = {
  async compute(orgId, db) {
    if (isSelfHosted()) {
      // Self-hosted: all features unlimited
      const obj: Record<string, FeatureLimit> = {}
      for (const key of Object.values(FeatureKey)) {
        obj[key] = '+'
      }
      return obj
    }

    // Fetch subscription
    const [subscription] = await db
      .select({
        status: schema.PlanSubscription.status,
        hasTrialEnded: schema.PlanSubscription.hasTrialEnded,
        planId: schema.PlanSubscription.planId,
        customFeatureLimits: schema.PlanSubscription.customFeatureLimits,
      })
      .from(schema.PlanSubscription)
      .where(eq(schema.PlanSubscription.organizationId, orgId))
      .limit(1)

    const { planMap } = await getAppCache().getOrRecompute(['planMap'])
    let featureDefinitions: FeatureDefinition[] = []

    if (subscription?.planId) {
      const plan = planMap[subscription.planId]

      if (!plan) {
        logger.warn('Plan not found in planMap', { orgId, planId: subscription.planId })
      } else if (subscription.status === 'trialing' && !subscription.hasTrialEnded) {
        featureDefinitions = parseFeatureLimits(plan.trialFeatureLimits ?? plan.featureLimits)
      } else if (subscription.status === 'active' || subscription.status === 'past_due') {
        featureDefinitions = parseFeatureLimits(plan.featureLimits)
      }
    } else {
      // No subscription — resolve from org type (demo vs free)
      const { orgProfile } = await getOrgCache().getOrRecompute(orgId, ['orgProfile'])
      const isDemo = orgProfile.demoExpiresAt !== null

      const fallbackPlan = isDemo
        ? Object.values(planMap).find((p) => p.name === 'Demo')
        : Object.values(planMap).find((p) => p.isFree)

      if (fallbackPlan) {
        featureDefinitions = parseFeatureLimits(fallbackPlan.featureLimits)
      } else {
        logger.error('No fallback plan found in planMap', { orgId, isDemo })
      }
    }

    // Build feature map
    const result: Record<string, FeatureLimit> = {}
    for (const def of featureDefinitions) {
      if (def && typeof def.key === 'string') {
        result[def.key] = def.limit === -1 ? '+' : def.limit
      }
    }

    // Apply custom feature limits (Enterprise customers)
    if (subscription?.customFeatureLimits) {
      try {
        const customLimits =
          typeof subscription.customFeatureLimits === 'string'
            ? JSON.parse(subscription.customFeatureLimits)
            : subscription.customFeatureLimits

        if (customLimits && typeof customLimits === 'object') {
          for (const [key, limit] of Object.entries(customLimits as Record<string, unknown>)) {
            if (typeof limit === 'number') {
              result[key] = limit === -1 ? '+' : limit
            } else if (typeof limit === 'boolean') {
              result[key] = limit
            }
          }
        }
      } catch (error) {
        logger.warn('Failed to parse custom feature limits', {
          orgId,
          error: (error as Error).message,
        })
      }
    }

    return result
  },
}
