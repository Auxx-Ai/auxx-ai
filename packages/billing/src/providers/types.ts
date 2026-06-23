// packages/billing/src/providers/types.ts

import type { Database } from '@auxx/database'
import type Stripe from 'stripe'
import type { PlanChangeHandler, WebhookHandlers } from '../types'

export type BillingProviderId = 'stripe' | 'shopify'

export interface BillingCapabilities {
  managedPaymentMethods: boolean
  selfServeBillingPortal: boolean
  prorationPreview: boolean
  arbitraryBillingCycles: boolean
  /** Whether annual billing is offered. Shopify is monthly-only (usage charges can't ride an annual cycle). */
  annualBillingCycle: boolean
  trialWithoutPaymentMethod: boolean
  immediateCancellation: boolean
  scheduledDowngrade: boolean
  invoiceLedger: boolean
}

export type CreateSubscriptionResult =
  | { kind: 'redirect'; url: string }
  | { kind: 'immediate'; subscriptionId: string }
  | { kind: 'requires_action'; subscriptionId: string; clientSecret: string }

export interface CreateSubscriptionInput {
  organizationId: string
  userEmail: string
  planName: string
  billingCycle: 'MONTHLY' | 'ANNUAL'
  seats?: number
  successUrl: string
  cancelUrl: string
  metadata?: Record<string, string>
}

export interface CancelSubscriptionInput {
  organizationId: string
}

export interface RestoreSubscriptionInput {
  organizationId: string
}

export interface UpdateSubscriptionDirectInput {
  organizationId: string
  userId?: string
  planName: string
  billingCycle: 'MONTHLY' | 'ANNUAL'
  seats: number
  paymentMethodId?: string
  previousPaymentMethodId?: string
}

export interface UpdateSubscriptionDirectResult {
  success: boolean
  subscriptionId: string
  requiresAction?: boolean
  clientSecret?: string
  immediate?: boolean
  scheduledFor?: Date
}

export interface BillingPortalInput {
  organizationId: string
  returnUrl: string
  locale?: string
}

export interface PreviewInput {
  organizationId: string
  planName: string
  billingCycle: 'MONTHLY' | 'ANNUAL'
  seats: number
}

export interface PreviewResult {
  organizationId: string
  subscriptionId: string | null
  transition:
    | 'renewal'
    | 'upgrade'
    | 'downgrade'
    | 'seat_addition'
    | 'seat_reduction'
    | 'switch_to_annual'
    | 'switch_to_monthly'
    | 'trial_to_paid'
  proration: { amount: number; currency: string; credit: number; note?: string } | null
  renewal: {
    currency: string
    total: number
    total_excluding_tax: number
    subtotal: number
    tax: number
    line_items: Array<{
      description: string
      amount: number
      quantity: number
      billing_product_id: string
      billing_product_price_id: string | null
    }>
    discount: number
    discount_metadata: null
    billing_starts?: Date | null
  }
  period_end: Date | null
}

export interface PaymentMethod {
  id: string
  brand: string
  last4: string
  expMonth: number
  expYear: number
  isDefault: boolean
}

export interface ProcessWebhookInput {
  db: Database
  // Stripe path — signature verified at the edge (route), dispatched by event type.
  event?: Stripe.Event
  handlers?: WebhookHandlers
  onPlanChange?: PlanChangeHandler
  // Shopify path — HMAC pre-verified by the route, dispatched by topic.
  rawBody?: string
  topic?: string
  shopDomain?: string
}

export interface BillingProvider {
  readonly id: BillingProviderId
  readonly capabilities: BillingCapabilities

  createSubscription(input: CreateSubscriptionInput): Promise<CreateSubscriptionResult>
  cancelSubscription(input: CancelSubscriptionInput): Promise<void>
  restoreSubscription(input: RestoreSubscriptionInput): Promise<void>
  processWebhook(
    input: ProcessWebhookInput
  ): Promise<{ success: boolean; organizationId?: string | null }>

  updateSubscriptionDirect?(
    input: UpdateSubscriptionDirectInput
  ): Promise<UpdateSubscriptionDirectResult>
  createBillingPortalUrl?(input: BillingPortalInput): Promise<{ url: string }>
  calculatePreview?(input: PreviewInput): Promise<PreviewResult>
  listPaymentMethods?(organizationId: string): Promise<PaymentMethod[]>
  createSetupIntent?(organizationId: string): Promise<{ clientSecret: string }>
  setDefaultPaymentMethod?(organizationId: string, paymentMethodId: string): Promise<void>
  deletePaymentMethod?(organizationId: string, paymentMethodId: string): Promise<void>
}
