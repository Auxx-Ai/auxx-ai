// packages/types/billing/plan.ts

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
