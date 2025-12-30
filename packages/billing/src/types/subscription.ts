// packages/billing/src/types/subscription.ts
/**
 * Subscription-related types for billing package.
 */

import type { PlanSubscription } from '@auxx/database'

/** Inferred type from PlanSubscription table */
type PlanSubscriptionType = typeof PlanSubscription.$inferSelect

/** Subscription creation input */
export interface CreateSubscriptionInput {
  organizationId: string
  planName: string
  billingCycle: 'MONTHLY' | 'ANNUAL'
  seats?: number
  metadata?: Record<string, string>
}

/** Subscription upgrade input */
export interface UpgradeSubscriptionInput {
  organizationId: string
  planName: string
  billingCycle: 'MONTHLY' | 'ANNUAL'
  seats?: number
  subscriptionId?: string
  successUrl: string
  cancelUrl: string
  returnUrl?: string
  metadata?: Record<string, string>
}

/** Subscription cancellation input */
export interface CancelSubscriptionInput {
  organizationId: string
  subscriptionId?: string
  returnUrl: string
}

/** Subscription restore input */
export interface RestoreSubscriptionInput {
  organizationId: string
  subscriptionId?: string
}

/** Billing portal input */
export interface BillingPortalInput {
  organizationId: string
  returnUrl: string
  locale?: string
}

/** Direct subscription update input */
export interface UpdateSubscriptionDirectInput {
  organizationId: string
  planName: string
  billingCycle: 'MONTHLY' | 'ANNUAL'
  seats: number
  paymentMethodId?: string
  previousPaymentMethodId?: string
  userId?: string
}

/** Direct subscription update result */
export interface UpdateSubscriptionDirectResult {
  success: boolean
  subscriptionId: string
  requiresAction?: boolean
  clientSecret?: string
  immediate?: boolean
  scheduledFor?: Date
}

/** Subscription with plan details */
export interface SubscriptionWithPlan extends PlanSubscriptionType {
  planDetails?: {
    name: string
    limits?: Record<string, number>
    priceId?: string
  }
}
