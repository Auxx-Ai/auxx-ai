// packages/billing/src/hooks/invoice-payment-failed.ts
/**
 * Webhook handler for failed invoice payment.
 */

import type Stripe from 'stripe'
import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { createScopedLogger } from '@auxx/logger'

/** Scoped logger for invoice payment failure webhook handling. */
const logger = createScopedLogger('webhook:invoice-payment-failed')

/**
 * Handles a Stripe `invoice.payment_failed` webhook event by syncing invoice data with the local database.
 *
 * Resolves the related subscription, updates or creates the invoice record with `PENDING` status, and ensures
 * failure details are logged for observability. Missing subscriptions or invoices are logged and silently return
 * without throwing. Any unexpected error is logged and rethrown so the webhook infrastructure can retry.
 *
 * @param db Database client for persisting invoice and subscription records.
 * @param event Stripe webhook event carrying the failed invoice payload.
 * @throws Error Propagates any thrown error so upstream handlers can manage retries.
 */
export async function handleInvoicePaymentFailed(db: Database, event: Stripe.Event): Promise<void> {
  try {
    const invoice = event.data.object as Stripe.Invoice
    const stripeInvoiceId = invoice.id!

    // Get subscription ID from line items
    const subscriptionId = invoice.lines?.data?.[0]?.subscription

    if (!subscriptionId) {
      logger.warn('Invoice not associated with subscription', {
        stripeInvoiceId,
      })
      return
    }

    // Extract subscription ID (can be string or object)
    const stripeSubscriptionId =
      typeof subscriptionId === 'string' ? subscriptionId : subscriptionId.id

    // Find local subscription
    const localSub = await db.query.PlanSubscription.findFirst({
      where: (sub, { eq }) => eq(sub.stripeSubscriptionId, stripeSubscriptionId),
    })

    if (!localSub) {
      logger.warn('Subscription not found for failed invoice', {
        stripeSubscriptionId,
        stripeInvoiceId,
      })
      return
    }

    // Check if invoice exists
    const existingInvoice = await db.query.Invoice.findFirst({
      where: (inv, { eq }) => eq(inv.stripeInvoiceId, stripeInvoiceId),
    })

    if (existingInvoice) {
      // Update status to PENDING (payment failed)
      await db
        .update(schema.Invoice)
        .set({
          status: 'PENDING',
          updatedAt: new Date(),
        })
        .where(eq(schema.Invoice.id, existingInvoice.id))

      logger.info('Invoice marked as payment failed', {
        invoiceId: existingInvoice.id,
        stripeInvoiceId,
      })
    } else {
      // Create invoice record with PENDING status
      await db.insert(schema.Invoice).values({
        organizationId: localSub.organizationId,
        subscriptionId: localSub.id,
        stripeInvoiceId: stripeInvoiceId,
        invoiceNumber: invoice.number ?? `INV-${stripeInvoiceId}`,
        amount: invoice.amount_due,
        status: 'PENDING',
        invoiceDate: new Date(invoice.created * 1000),
        dueDate: invoice.due_date ? new Date(invoice.due_date * 1000) : new Date(),
        currency: invoice.currency.toUpperCase(),
        billingReason: invoice.billing_reason ?? undefined,
        pdfUrl: invoice.invoice_pdf ?? undefined,
        updatedAt: new Date(),
      })

      logger.info('Failed invoice created', {
        stripeInvoiceId,
        organizationId: localSub.organizationId,
      })
    }

    // Log payment failure warning
    logger.warn('Payment failed for organization', {
      organizationId: localSub.organizationId,
      invoiceId: stripeInvoiceId,
      attemptCount: invoice.attempt_count,
    })
  } catch (error: any) {
    logger.error('Stripe webhook failed in invoice payment failed', { error: error.message })
    throw error
  }
}
