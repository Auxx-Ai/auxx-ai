// packages/billing/src/index.ts
/**
 * Main exports for billing package.
 */

export * from './hooks'
export { getProvider, resolveBillingProvider } from './providers/registry'
export {
  type ActiveSubscription,
  type AppPricingInterval,
  type AppSubscriptionStatus,
  createShopifyAdminClient,
  ensureBillingWebhooks,
  getActiveSubscription,
  type LocalStatus as ShopifyLocalStatus,
  mapActiveSubscriptionToStatus,
  postSeatDayEvent,
  reportOrgSeatDay,
  type SeatDayEvent,
  type SeatDayEventStatus,
  type SeatDayReport,
  ShopifyBillingProvider,
  type ShopifyPlanAction,
} from './providers/shopify'
export { StripeBillingProvider } from './providers/stripe'
export type {
  BillingCapabilities,
  BillingProvider,
  BillingProviderId,
  CreateSubscriptionResult,
  PaymentMethod,
  PreviewInput,
  PreviewResult,
  ProcessWebhookInput,
} from './providers/types'
export { AdminBillingService, type CustomFeatureLimits } from './services/admin-billing-service'
export { BillingPortalService } from './services/billing-portal-service'
export { CustomerService } from './services/customer-service'
export type {
  CreatePlanInput,
  FeatureLimit,
  ListPlansOptions,
  UpdatePlanInput,
  UpdatePricingInput,
} from './services/plan-admin-service'
export { PlanAdminService } from './services/plan-admin-service'
export { PlanService } from './services/plan-service'
export {
  type ComputePlanPreviewBaseInput,
  type ComputePlanPreviewBaseResult,
  computePlanPreviewBase,
  type PreviewLineItem,
  type PreviewRenewal,
  type PreviewTransition,
} from './services/preview-base'
export { stripeClient } from './services/stripe-client'
export { SubscriptionService } from './services/subscription-service'
export { WebhookService } from './services/webhook-service'
export * from './types'
export * from './utils/audit-logger'
export * from './utils/error-codes'
export * from './utils/url-helpers'
