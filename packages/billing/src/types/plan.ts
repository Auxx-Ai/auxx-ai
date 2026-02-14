// packages/billing/src/types/plan.ts
/**
 * Plan-related types for billing package.
 */

/** Extended plan configuration with runtime behavior */
export interface BillingPlan {
  /** Database plan reference */
  id: string
  /** Plan name (e.g., "starter", "pro", "enterprise") */
  name: string
  /** Monthly Stripe price ID */
  stripePriceIdMonthly?: string
  /** Annual Stripe price ID */
  stripePriceIdAnnual?: string
  /** Monthly lookup key (alternative to price ID) */
  lookupKeyMonthly?: string
  /** Annual lookup key (alternative to price ID) */
  lookupKeyAnnual?: string
  /** Feature limits (e.g., { emails: 1000, users: 5 }) */
  limits?: Record<string, number>
  /** Trial configuration */
  trial?: {
    days: number
    onTrialStart?: (subscriptionId: string) => Promise<void>
    onTrialEnd?: (subscriptionId: string) => Promise<void>
    onTrialExpired?: (subscriptionId: string) => Promise<void>
  }
}

/** Plan lookup options */
export interface PlanLookupOptions {
  /** Look up by plan name */
  name?: string
  /** Look up by Stripe price ID */
  priceId?: string
  /** Look up by Stripe lookup key */
  lookupKey?: string
}
