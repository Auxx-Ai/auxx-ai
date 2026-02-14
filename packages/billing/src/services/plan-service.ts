// packages/billing/src/services/plan-service.ts
/**
 * Plan operations service for billing.
 */

import type { Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { BillingPlan, PlanLookupOptions } from '../types'

/**
 * Provides helpers for retrieving and mapping billing plans from the persistence layer so downstream
 * modules interact with normalized `BillingPlan` objects. Consolidates lookup logic for plan
 * identifiers (name, Stripe price IDs, lookup keys) and ensures consistent filtering of legacy
 * records.
 */
export class PlanService {
  /**
   * Creates a plan service tied to a specific database connection, allowing callers to reuse a shared
   * instance without reconfiguring dependencies.
   *
   * @param db - Drizzle database client that exposes typed queries and mutations for plan entities.
   */
  constructor(private db: Database) {}

  /**
   * Fetches all non-legacy plans ordered by hierarchy level and converts them into `BillingPlan`
   * objects for consumption by API, UI, or pricing logic.
   *
   * @returns Promise resolving to an array of normalized billing plans sorted from lowest to highest hierarchy.
   */
  async getPlans(): Promise<BillingPlan[]> {
    const plans = await this.db.query.Plan.findMany({
      where: (plan, { eq }) => eq(plan.isLegacy, false),
      orderBy: (plan, { asc }) => [asc(plan.hierarchyLevel)],
    })

    return plans.map(this.transformPlan)
  }

  /**
   * Resolves a single billing plan by evaluating lookups in priority order: exact name match,
   * Stripe price identifier (monthly or annual), then lookup key variants. Uses cached plan results
   * from `getPlans` when possible to minimize database calls.
   *
   * @param options - Criteria used to search for a plan; supports name, price ID, or lookup key.
   * @returns Promise resolving to the matched `BillingPlan` or `null` when nothing satisfies the criteria.
   */
  async findPlan(options: PlanLookupOptions): Promise<BillingPlan | null> {
    if (options.name) {
      const plan = await this.db.query.Plan.findFirst({
        where: (p, { eq, and }) => and(eq(p.name, options.name!), eq(p.isLegacy, false)),
      })
      return plan ? this.transformPlan(plan) : null
    }

    // For price ID or lookup key, we need to check both monthly and annual
    const plans = await this.getPlans()

    if (options.priceId) {
      return (
        plans.find(
          (p) =>
            p.stripePriceIdMonthly === options.priceId || p.stripePriceIdAnnual === options.priceId
        ) ?? null
      )
    }

    if (options.lookupKey) {
      return (
        plans.find(
          (p) => p.lookupKeyMonthly === options.lookupKey || p.lookupKeyAnnual === options.lookupKey
        ) ?? null
      )
    }

    return null
  }

  /**
   * Converts a raw database plan record into the normalized `BillingPlan` structure expected by
   * consumers. Lowercases the plan name, preserves optional identifiers, and attaches trial metadata
   * only when applicable.
   *
   * @param plan - Raw plan row obtained from Drizzle queries.
   * @returns Normalized billing plan ready for downstream processing.
   */
  private transformPlan(plan: typeof schema.Plan.$inferSelect): BillingPlan {
    return {
      id: plan.id,
      name: plan.name.toLowerCase(),
      stripePriceIdMonthly: plan.stripePriceIdMonthly ?? undefined,
      stripePriceIdAnnual: plan.stripePriceIdAnnual ?? undefined,
      limits: (plan.featureLimits as Record<string, number>) ?? undefined,
      trial: plan.hasTrial
        ? {
            days: plan.trialDays,
          }
        : undefined,
    }
  }
}
