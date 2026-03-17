// packages/billing/src/types/plan.ts
/**
 * Plan-related types for billing package.
 */

// BillingPlan is now exported from @auxx/types/billing

/** Plan lookup options */
export interface PlanLookupOptions {
  /** Look up by plan name */
  name?: string
  /** Look up by Stripe price ID */
  priceId?: string
  /** Look up by Stripe lookup key */
  lookupKey?: string
}
