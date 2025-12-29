// packages/billing/src/types/webhook.ts
/**
 * Webhook-related types for billing package.
 */

import type Stripe from 'stripe'

/** Webhook event handlers */
export interface WebhookHandlers {
  onCheckoutSessionCompleted?: (event: Stripe.Event) => Promise<void>
  onSubscriptionCreated?: (event: Stripe.Event) => Promise<void>
  onSubscriptionUpdated?: (event: Stripe.Event) => Promise<void>
  onSubscriptionDeleted?: (event: Stripe.Event) => Promise<void>
  onCustomerCreated?: (event: Stripe.Event) => Promise<void>
  onInvoicePaid?: (event: Stripe.Event) => Promise<void>
  onInvoicePaymentFailed?: (event: Stripe.Event) => Promise<void>
}

/** Invoice sync result */
export interface InvoiceSyncResult {
  invoiceId: string
  status: 'created' | 'updated'
  stripeInvoiceId: string
}
