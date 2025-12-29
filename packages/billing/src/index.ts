// packages/billing/src/index.ts
/**
 * Main exports for billing package.
 */

export * from './types'
export { stripeClient } from './services/stripe-client'
export { SubscriptionService } from './services/subscription-service'

export { CustomerService } from './services/customer-service'
export { PlanService } from './services/plan-service'
export { BillingPortalService } from './services/billing-portal-service'
export { WebhookService } from './services/webhook-service'
export { AdminBillingService, type CustomFeatureLimits } from './services/admin-billing-service'
export { PlanAdminService } from './services/plan-admin-service'
export type {
  CreatePlanInput,
  UpdatePlanInput,
  UpdatePricingInput,
  ListPlansOptions,
  FeatureLimit,
} from './services/plan-admin-service'
export * from './utils/error-codes'
export * from './utils/url-helpers'
export * from './utils/audit-logger'
export * from './hooks'
