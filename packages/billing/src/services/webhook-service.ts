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

/** Scoped logger for Stripe webhook service operations. */
const logger = createScopedLogger('webhook-service')

/**
 * Dispatches a PRE-VERIFIED Stripe webhook event to first-party and custom handlers.
 *
 * Signature verification happens at the edge (the tier-5 route, via
 * `@auxx/lib/webhooks` `verifyStripeSignature`) — billing is tier-2 and cannot import
 * lib, so it no longer owns the Stripe SDK verify. This service only routes the
 * already-authenticated event.
 */
export class WebhookService {
  /**
   * Creates a webhook service bound to a specific database connection.
   *
   * @param db Database client used to persist or query subscription, invoice, and customer records.
   * @param customHandlers Optional consumer-provided callbacks that run alongside the built-in handlers.
   */
  constructor(
    private db: Database,
    private customHandlers?: WebhookHandlers,
    private onPlanChange?: PlanChangeHandler
  ) {}

  /**
   * Dispatches a pre-verified Stripe event to first-party and custom handlers.
   *
   * @param event The Stripe event, already verified by the caller.
   * @returns Object indicating the webhook event was processed successfully.
   * @throws Error When downstream handlers report an error during processing.
   */
  async processVerifiedEvent(event: Stripe.Event): Promise<{ success: boolean }> {
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
