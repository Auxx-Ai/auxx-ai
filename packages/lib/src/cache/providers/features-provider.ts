// packages/lib/src/cache/providers/features-provider.ts

import { schema } from '@auxx/database'
import { isSelfHosted } from '@auxx/deployment'
import { eq } from 'drizzle-orm'
import { createScopedLogger } from '../../logger'
import type { FeatureDefinition, FeatureLimit, FeatureMapObject } from '../../permissions/types'
import { DEFAULT_FREE_PLAN_FEATURES, FeatureKey } from '../../permissions/types'
import type { CacheProvider } from '../org-cache-provider'

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

    let featureDefinitions: FeatureDefinition[] = DEFAULT_FREE_PLAN_FEATURES

    if (subscription?.planId) {
      const [plan] = await db
        .select({
          featureLimits: schema.Plan.featureLimits,
          trialFeatureLimits: schema.Plan.trialFeatureLimits,
        })
        .from(schema.Plan)
        .where(eq(schema.Plan.id, subscription.planId))
        .limit(1)

      if (subscription.status === 'trialing' && !subscription.hasTrialEnded) {
        const trialSource = plan?.trialFeatureLimits ?? plan?.featureLimits
        featureDefinitions = parseFeaturesFromJson(trialSource)
      } else if (subscription.status === 'active') {
        featureDefinitions = parseFeaturesFromJson(plan?.featureLimits)
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

function parseFeaturesFromJson(featuresJson: unknown): FeatureDefinition[] {
  if (!featuresJson) return DEFAULT_FREE_PLAN_FEATURES
  try {
    const parsed = typeof featuresJson === 'string' ? JSON.parse(featuresJson) : featuresJson
    return Array.isArray(parsed) ? (parsed as FeatureDefinition[]) : DEFAULT_FREE_PLAN_FEATURES
  } catch {
    return DEFAULT_FREE_PLAN_FEATURES
  }
}
