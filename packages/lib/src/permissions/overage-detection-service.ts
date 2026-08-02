// packages/lib/src/permissions/overage-detection-service.ts

import { type Database, database as ddb, schema } from '@auxx/database'
import { isSelfHosted } from '@auxx/deployment'
import { and, count, eq, isNull } from 'drizzle-orm'
import { getAppCache } from '../cache'
import { getOrgCache } from '../cache/singletons'
import { countBillableChannels } from '../channels'
import { createScopedLogger } from '../logger'
import { countSequencesUsed } from '../sequences/sequence-limits'
import { countSavedViewsUsed } from '../table-views/saved-view-limits'
import type { FeatureDefinition } from './types'
import { FEATURE_REGISTRY_MAP, FeatureKey, parseFeatureLimits } from './types'

const logger = createScopedLogger('overage-detection-service')

/**
 * Static-typed features that are NOT standing, countable resources.
 * These are metered monthly pools (tracked via OrganizationAiQuota and the
 * quota webhook handlers), so they must be excluded from resource-count
 * overage detection — there is nothing to count, and treating them here would
 * report a count of 0 and mask real usage.
 */
const NON_COUNTABLE_STATIC_KEYS = new Set<string>([FeatureKey.monthlyAiCredits])

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

    const featureDefs = parseFeatureLimits(plan.featureLimits)

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

    // Fetch plan limits from cache
    const planMap = await getAppCache().get('planMap')
    let featureDefs: FeatureDefinition[] = []
    let customFeatureLimits: unknown = null

    if (subscription?.planId) {
      const plan = planMap[subscription.planId]
      if (!plan) return []

      const isTrialing = subscription.status === 'trialing' && !subscription.hasTrialEnded
      const rawLimits = isTrialing
        ? (plan.trialFeatureLimits ?? plan.featureLimits)
        : plan.featureLimits

      featureDefs = parseFeatureLimits(rawLimits)
      customFeatureLimits = subscription.customFeatureLimits
    } else {
      // No subscription — resolve from org type (demo vs free)
      const { orgProfile } = await getOrgCache().getOrRecompute(organizationId, ['orgProfile'])
      const isDemo = orgProfile.demoExpiresAt !== null

      const fallbackPlan = isDemo
        ? Object.values(planMap).find((p) => p.name === 'Demo')
        : Object.values(planMap).find((p) => p.isFree)

      if (!fallbackPlan) {
        logger.warn('No fallback plan found for overage detection', { organizationId, isDemo })
        return []
      }

      featureDefs = parseFeatureLimits(fallbackPlan.featureLimits)
    }

    const effectiveLimits = this.buildEffectiveLimits(featureDefs, customFeatureLimits)

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
      if (NON_COUNTABLE_STATIC_KEYS.has(def.key)) continue // metered pools, not standing resources
      if (meta.perOperation) continue // per-operation caps aren't standing resources
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
        if (NON_COUNTABLE_STATIC_KEYS.has(key)) continue
        if (meta.perOperation) continue
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
      // Both seat classes delegate to the one shared seat counter that the
      // invite and seat-change gates use — two independent counters for one
      // billing invariant is how they drifted apart before. Members only
      // (a pending invitation is not yet occupying a seat), ACTIVE, human, and
      // scoped to the class: field (worker) seats are counted separately from
      // full seats (§8).
      //
      // Lazy import: `members/seat-limits` → `permissions/feature-permission-service`
      // → the `cache` barrel → `register-providers` → `overages-provider` → this
      // file, so a static import would close an ESM cycle (and break `vi.mock`
      // in tests). Same reason the members module lazy-imports `../cache`.
      case FeatureKey.teammates:
      case FeatureKey.workerSeats: {
        const { countSeatsUsed } = await import('../members/seat-limits')
        return countSeatsUsed(
          {
            organizationId,
            seatType: featureKey === FeatureKey.workerSeats ? 'worker' : 'full',
            includePendingInvitations: false,
          },
          this.db
        )
      }

      case FeatureKey.channels:
        return countBillableChannels(this.db, organizationId)

      case FeatureKey.workflowsLimit: {
        // Only org-authored workflows count. A sequence compiles to a hidden,
        // system-owned `WorkflowApp` (`ownerType = 'sequence'`) — every new org is
        // seeded with 5 of them (`seedClientNotificationSequences`), and they are
        // invisible in the workflows list and excluded from the create gate's
        // `getCachedWorkflowAppCount`. Counting them here reported every fresh org
        // as 5/3 over its workflow limit before a single workflow existed.
        const [result] = await this.db
          .select({ value: count() })
          .from(schema.WorkflowApp)
          .where(
            and(
              eq(schema.WorkflowApp.organizationId, organizationId),
              isNull(schema.WorkflowApp.ownerType)
            )
          )
        return result?.value ?? 0
      }

      case FeatureKey.sequencesLimit: {
        // Org-authored sequences only — the 5 seeded client-notification templates are
        // undeletable, so counting them would strand every org over its cap. See
        // `countSequencesUsed`.
        return countSequencesUsed(this.db, organizationId)
      }

      case FeatureKey.mailFiltersLimit: {
        // Shared-inbox filters only, seeded (`templateKey`) rows excluded — the same
        // counter the create gate calls, so the gate and this detector cannot drift.
        // Personal-inbox filters are deliberately NOT counted: pooling them into the
        // org allowance lets one member exhaust the plan for everyone (they carry a
        // flat per-user ceiling instead).
        //
        // Lazy import for the same ESM-cycle reason as `countSeatsUsed` above:
        // `mail-filters/limits` reaches the `cache` barrel → `register-providers` →
        // `overages-provider` → this file, so a static import would close the cycle
        // (and break `vi.mock` in tests).
        const { countBillableMailFilters } = await import('../mail-filters/limits')
        return countBillableMailFilters(this.db, organizationId)
      }

      case FeatureKey.savedViews: {
        // Shared, member-created views across TableView + MailView. Delegates to the
        // one shared counter the create gates use — see `countSavedViewsUsed` for why
        // system-seeded views are excluded.
        return countSavedViewsUsed(this.db, organizationId)
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
        // Exclude managed datasets (e.g. KB-synced private datasets) — they don't count toward plan limits.
        const [result] = await this.db
          .select({ value: count() })
          .from(schema.Dataset)
          .where(
            and(
              eq(schema.Dataset.organizationId, organizationId),
              eq(schema.Dataset.isManaged, false)
            )
          )
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

      case FeatureKey.agentsLimit: {
        // Count non-archived agents (drafts included), matching listAgents() enforcement.
        const [result] = await this.db
          .select({ value: count() })
          .from(schema.Agent)
          .where(
            and(eq(schema.Agent.organizationId, organizationId), isNull(schema.Agent.archivedAt))
          )
        return result?.value ?? 0
      }

      default:
        logger.warn('Unknown feature key for resource count', { featureKey })
        return 0
    }
  }
}
