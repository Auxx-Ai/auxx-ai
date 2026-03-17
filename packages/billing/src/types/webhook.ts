// packages/billing/src/types/webhook.ts
/**
 * Webhook-related types for billing package.
 */

import type { Database } from '@auxx/database'
import type Stripe from 'stripe'

/** Callback invoked when a plan change (downgrade or trial expiry) requires overage detection. */
export type PlanChangeHandler = (
  db: Database,
  organizationId: string,
  newPlanId: string
) => Promise<void>

/** Context passed to webhook callbacks after the billing handler runs. */
export interface WebhookEventContext {
  organizationId: string | null
}

/** Webhook event handlers */
export interface WebhookHandlers {
  onCheckoutSessionCompleted?: (event: Stripe.Event, ctx: WebhookEventContext) => Promise<void>
  onSubscriptionCreated?: (event: Stripe.Event, ctx: WebhookEventContext) => Promise<void>
  onSubscriptionUpdated?: (event: Stripe.Event, ctx: WebhookEventContext) => Promise<void>
  onSubscriptionDeleted?: (event: Stripe.Event, ctx: WebhookEventContext) => Promise<void>
  onCustomerCreated?: (event: Stripe.Event) => Promise<void>
  onInvoicePaid?: (event: Stripe.Event, ctx: WebhookEventContext) => Promise<void>
  onInvoicePaymentFailed?: (event: Stripe.Event, ctx: WebhookEventContext) => Promise<void>
}

/** Invoice sync result */
export interface InvoiceSyncResult {
  invoiceId: string
  status: 'created' | 'updated'
  stripeInvoiceId: string
}
