// packages/billing/src/services/webhook-service.ts
/**
 * Webhook processing service for Stripe events.
 */

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type Stripe from 'stripe'
import {
  handleCheckoutSessionCompleted,
  handleInvoicePaid,
  handleInvoicePaymentFailed,
  handleSubscriptionCreated,
  handleSubscriptionDeleted,
  handleSubscriptionUpdated,
} from '../hooks'
import type { PlanChangeHandler, WebhookHandlers } from '../types'
import { stripeClient } from './stripe-client'

/** Scoped logger for Stripe webhook service operations. */
const logger = createScopedLogger('webhook-service')

/**
 * Orchestrates verification and dispatch of Stripe webhook events to internal handlers.
 *
 * Ensures payload authenticity by validating the Stripe signature, then routes supported event types to
 * first-party hooks and optional consumer-provided handlers. Errors are logged with context before being surfaced
 * to upstream middleware so retry logic can take effect.
 */
export class WebhookService {
  /**
   * Creates a webhook service bound to a specific database connection and Stripe signing secret.
   *
   * @param db Database client used to persist or query subscription, invoice, and customer records.
   * @param webhookSecret Stripe webhook signing secret for validating incoming payloads.
   * @param customHandlers Optional consumer-provided callbacks that run alongside the built-in handlers.
   */
  constructor(
    private db: Database,
    private webhookSecret: string,
    private customHandlers?: WebhookHandlers,
    private onPlanChange?: PlanChangeHandler
  ) {}

  /**
   * Validates the Stripe webhook signature and dispatches the event to first-party and custom handlers.
   *
   * @param body Raw request body as received from Stripe.
   * @param signature `Stripe-Signature` header string used for signature verification.
   * @returns Object indicating the webhook event was processed successfully.
   * @throws Error When signature verification fails or downstream handlers report an error during processing.
   */
  async processWebhook(body: string, signature: string): Promise<{ success: boolean }> {
    // Verify webhook signature
    let event: Stripe.Event
    try {
      event = await stripeClient
        .getClient()
        .webhooks.constructEventAsync(body, signature, this.webhookSecret)
    } catch (err: any) {
      logger.error('Webhook signature verification failed', { error: err.message })
      throw new Error(`Webhook Error: ${err.message}`)
    }

    // Process event
    try {
      switch (event.type) {
        case 'checkout.session.completed': {
          const result = await handleCheckoutSessionCompleted(this.db, event)
          await this.customHandlers?.onCheckoutSessionCompleted?.(event, {
            organizationId: result?.organizationId ?? null,
          })
          break
        }

        case 'customer.subscription.updated': {
          const result = await handleSubscriptionUpdated(this.db, event, this.onPlanChange)
          await this.customHandlers?.onSubscriptionUpdated?.(event, {
            organizationId: result?.organizationId ?? null,
          })
          break
        }

        case 'customer.subscription.created': {
          const result = await handleSubscriptionCreated(this.db, event, this.onPlanChange)
          await this.customHandlers?.onSubscriptionCreated?.(event, {
            organizationId: result?.organizationId ?? null,
          })
          break
        }

        case 'customer.subscription.deleted': {
          const result = await handleSubscriptionDeleted(this.db, event)
          await this.customHandlers?.onSubscriptionDeleted?.(event, {
            organizationId: result?.organizationId ?? null,
          })
          break
        }

        case 'customer.created':
          await this.customHandlers?.onCustomerCreated?.(event)
          break

        case 'invoice.paid': {
          const result = await handleInvoicePaid(this.db, event)
          await this.customHandlers?.onInvoicePaid?.(event, {
            organizationId: result?.organizationId ?? null,
          })
          break
        }

        case 'invoice.payment_failed': {
          const result = await handleInvoicePaymentFailed(this.db, event)
          await this.customHandlers?.onInvoicePaymentFailed?.(event, {
            organizationId: result?.organizationId ?? null,
          })
          break
        }

        default:
          logger.info('Unhandled webhook event', { type: event.type })
      }
    } catch (err: any) {
      logger.error('Webhook processing failed', {
        type: event.type,
        error: err.message,
      })
      throw new Error('Webhook processing failed')
    }

    return { success: true }
  }
}
