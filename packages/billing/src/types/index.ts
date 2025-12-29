// packages/billing/src/types/index.ts
/**
 * Shared types for billing package.
 */

export * from './plan'
export * from './subscription'
export * from './webhook'

export type BillingCycle = 'MONTHLY' | 'ANNUAL'

export type SubscriptionStatus =
  | 'ACTIVE'
  | 'CANCELED'
  | 'PAST_DUE'
  | 'UNPAID'
  | 'TRIALING'
  | 'INCOMPLETE'
  | 'INCOMPLETE_EXPIRED'
  | 'PAUSED'

export type TrialConversionStatus = 'PENDING' | 'CONVERTED' | 'EXPIRED' | 'CANCELED'

export interface PlanLimits {
  TEAMMATES?: number
  CHANNELS?: number
  MONTHLY_EMAILS?: number
  AI_REQUESTS?: number
  [key: string]: number | undefined
}

export interface PlanFeature {
  name: string
  description?: string
  included: boolean
  limit?: number
}
