// packages/types/billing/subscription.ts

import type { PlanSubscription } from '@auxx/database'

/** Inferred type from PlanSubscription table */
type PlanSubscriptionType = typeof PlanSubscription.$inferSelect

/** Subscription with plan details */
export interface SubscriptionWithPlan extends PlanSubscriptionType {
  planDetails?: {
    name: string
    limits?: Record<string, number>
    priceId?: string
  }
}
