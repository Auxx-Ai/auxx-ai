// packages/lib/src/permissions/overage-detection-service.ts

import { type Database, database as ddb, schema } from '@auxx/database'
import { isSelfHosted } from '@auxx/deployment'
import { and, count, eq, isNull } from 'drizzle-orm'
import { getAppCache } from '../cache'
import { createScopedLogger } from '../logger'
import type { FeatureDefinition } from './types'
import { DEFAULT_FREE_PLAN_FEATURES, FEATURE_REGISTRY_MAP, FeatureKey } from './types'

const logger = createScopedLogger('overage-detection-service')

/** Overage detected for a single feature */
export interface Overage {
  key: string
  label: string
  current: number
  limit: number
  excess: number
}

/**
 * Detects resource overages for an organization against plan limits.
 * Used when plans change (downgrade, admin change, trial expiry)
 * and in dehydration to show overage banners.
 */
export class OverageDetectionService {
  private db: Database

  constructor(db?: unknown) {
    this.db = db && typeof (db as any).select === 'function' ? (db as Database) : (ddb as Database)
  }

  /**
   * Detect all overages for an organization against a specific plan's limits.
   * Used when a plan change occurs (downgrade, admin change, trial expiry).
   */
  async detectOverages(organizationId: string, planId: string): Promise<Overage[]> {
    if (isSelfHosted()) return []

    // Fetch plan limits from cache
    const planMap = await getAppCache().get('planMap')
    const plan = planMap[planId]

    if (!plan) {
      logger.warn('Plan not found for overage detection', { planId })
      return []
    }

    const featureDefs = this.parseFeaturesFromJson(plan.featureLimits)

    // Merge custom feature limits from subscription if present
    const [subscription] = await this.db
      .select({
        customFeatureLimits: schema.PlanSubscription.customFeatureLimits,
        status: schema.PlanSubscription.status,
        hasTrialEnded: schema.PlanSubscription.hasTrialEnded,
      })
      .from(schema.PlanSubscription)
      .where(eq(schema.PlanSubscription.organizationId, organizationId))
      .limit(1)

    const effectiveLimits = this.buildEffectiveLimits(
      featureDefs,
      subscription?.customFeatureLimits
    )

    return this.compareCountsToLimits(organizationId, effectiveLimits)
  }

  /**
   * Detect overages against the org's CURRENT plan.
   * Used by dehydration to include overages in client state.
   */
  async detectCurrentOverages(organizationId: string): Promise<Overage[]> {
    if (isSelfHosted()) return []

    const [subscription] = await this.db
      .select({
        planId: schema.PlanSubscription.planId,
        status: schema.PlanSubscription.status,
        hasTrialEnded: schema.PlanSubscription.hasTrialEnded,
        customFeatureLimits: schema.PlanSubscription.customFeatureLimits,
      })
      .from(schema.PlanSubscription)
      .where(eq(schema.PlanSubscription.organizationId, organizationId))
      .limit(1)

    if (!subscription?.planId) return []

    // Fetch plan limits from cache — use trial limits if still trialing
    const planMap = await getAppCache().get('planMap')
    const plan = planMap[subscription.planId]

    if (!plan) return []

    const isTrialing = subscription.status === 'trialing' && !subscription.hasTrialEnded
    const rawLimits = isTrialing
      ? (plan.trialFeatureLimits ?? plan.featureLimits)
      : plan.featureLimits

    const featureDefs = this.parseFeaturesFromJson(rawLimits)
    const effectiveLimits = this.buildEffectiveLimits(featureDefs, subscription.customFeatureLimits)

    return this.compareCountsToLimits(organizationId, effectiveLimits)
  }

  /**
   * Compare current resource counts against effective limits for all static features.
   */
  private async compareCountsToLimits(
    organizationId: string,
    limits: Map<string, number>
  ): Promise<Overage[]> {
    const overages: Overage[] = []

    // Run all count queries in parallel
    const entries = [...limits.entries()]
    const counts = await Promise.all(
      entries.map(([key]) => this.getResourceCount(organizationId, key))
    )

    for (let i = 0; i < entries.length; i++) {
      const [key, limit] = entries[i]!
      const current = counts[i]!

      if (current > limit) {
        const meta = FEATURE_REGISTRY_MAP.get(key as FeatureKey)
        overages.push({
          key,
          label: meta?.label ?? key,
          current,
          limit,
          excess: current - limit,
        })
      }
    }

    if (overages.length > 0) {
      logger.info('Overages detected', { organizationId, overages })
    }

    return overages
  }

  /**
   * Build a map of feature key -> numeric limit for all static features.
   * Merges custom limits on top of plan limits.
   */
  private buildEffectiveLimits(
    featureDefs: FeatureDefinition[],
    customFeatureLimits: unknown
  ): Map<string, number> {
    const limits = new Map<string, number>()

    // Only check static-limit features with finite numeric limits
    for (const def of featureDefs) {
      const meta = FEATURE_REGISTRY_MAP.get(def.key as FeatureKey)
      if (meta?.type !== 'static') continue
      if (typeof def.limit !== 'number' || def.limit === -1) continue // skip '+', boolean, and -1 (unlimited)
      limits.set(def.key, def.limit)
    }

    // Apply custom overrides
    if (customFeatureLimits && typeof customFeatureLimits === 'object') {
      const parsed =
        typeof customFeatureLimits === 'string'
          ? JSON.parse(customFeatureLimits)
          : customFeatureLimits

      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        const meta = FEATURE_REGISTRY_MAP.get(key as FeatureKey)
        if (meta?.type !== 'static') continue
        if (typeof value === 'number') {
          if (value === -1) {
            // -1 means unlimited — remove from limits map
            limits.delete(key)
          } else {
            limits.set(key, value)
          }
        }
      }
    }

    return limits
  }

  /**
   * Get the current count for a specific feature.
   * Centralizes all count queries for static-limit features.
   */
  private async getResourceCount(organizationId: string, featureKey: string): Promise<number> {
    switch (featureKey) {
      case FeatureKey.teammates: {
        const [result] = await this.db
          .select({ value: count() })
          .from(schema.OrganizationMember)
          .where(
            and(
              eq(schema.OrganizationMember.organizationId, organizationId),
              eq(schema.OrganizationMember.status, 'ACTIVE')
            )
          )
        return result?.value ?? 0
      }

      case FeatureKey.channels: {
        const [result] = await this.db
          .select({ value: count() })
          .from(schema.Integration)
          .where(
            and(
              eq(schema.Integration.organizationId, organizationId),
              isNull(schema.Integration.deletedAt)
            )
          )
        return result?.value ?? 0
      }

      case FeatureKey.rules: {
        const [result] = await this.db
          .select({ value: count() })
          .from(schema.WorkflowApp)
          .where(eq(schema.WorkflowApp.organizationId, organizationId))
        return result?.value ?? 0
      }

      case FeatureKey.savedViews: {
        // Sum shared views from both TableView and MailView
        const [tableResult] = await this.db
          .select({ value: count() })
          .from(schema.TableView)
          .where(
            and(
              eq(schema.TableView.organizationId, organizationId),
              eq(schema.TableView.isShared, true)
            )
          )
        const [mailResult] = await this.db
          .select({ value: count() })
          .from(schema.MailView)
          .where(
            and(
              eq(schema.MailView.organizationId, organizationId),
              eq(schema.MailView.isShared, true)
            )
          )
        return (tableResult?.value ?? 0) + (mailResult?.value ?? 0)
      }

      case FeatureKey.kbPublishedArticles: {
        const [result] = await this.db
          .select({ value: count() })
          .from(schema.Article)
          .where(
            and(
              eq(schema.Article.organizationId, organizationId),
              eq(schema.Article.status, 'PUBLISHED')
            )
          )
        return result?.value ?? 0
      }

      case FeatureKey.knowledgeBases: {
        const [result] = await this.db
          .select({ value: count() })
          .from(schema.KnowledgeBase)
          .where(eq(schema.KnowledgeBase.organizationId, organizationId))
        return result?.value ?? 0
      }

      case FeatureKey.datasetsLimit: {
        const [result] = await this.db
          .select({ value: count() })
          .from(schema.Dataset)
          .where(eq(schema.Dataset.organizationId, organizationId))
        return result?.value ?? 0
      }

      case FeatureKey.entities: {
        const [result] = await this.db
          .select({ value: count() })
          .from(schema.EntityDefinition)
          .where(
            and(
              eq(schema.EntityDefinition.organizationId, organizationId),
              isNull(schema.EntityDefinition.entityType),
              isNull(schema.EntityDefinition.archivedAt)
            )
          )
        return result?.value ?? 0
      }

      default:
        logger.warn('Unknown feature key for resource count', { featureKey })
        return 0
    }
  }

  /** Parse features JSON from plan, falling back to free plan defaults */
  private parseFeaturesFromJson(featuresJson: unknown): FeatureDefinition[] {
    if (!featuresJson) return DEFAULT_FREE_PLAN_FEATURES
    try {
      const parsed = typeof featuresJson === 'string' ? JSON.parse(featuresJson) : featuresJson
      return Array.isArray(parsed) ? (parsed as FeatureDefinition[]) : DEFAULT_FREE_PLAN_FEATURES
    } catch {
      return DEFAULT_FREE_PLAN_FEATURES
    }
  }
}
