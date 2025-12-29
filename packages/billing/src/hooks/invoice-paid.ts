// packages/billing/src/hooks/invoice-paid.ts
/**
 * Webhook handler for successful invoice payment.
 */

import type Stripe from 'stripe'
import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { createScopedLogger } from '@auxx/logger'

/** Scoped logger for invoice payment webhook processing. */
const logger = createScopedLogger('webhook:invoice-paid')

/**
 * Handles a Stripe `invoice.paid` webhook by persisting the payment outcome in the local database.
 *
 * Locates the related subscription, updates an existing invoice with paid details or creates a new record,
 * and logs success or missing-resource conditions for observability. Unexpected failures are captured in the
 * scoped logger before bubbling up so upstream retry mechanisms can engage.
 *
 * @param db Database client used to read and write invoice/subscription records.
 * @param event Stripe webhook event carrying the paid invoice payload.
 * @throws Error Re-throws any underlying error to allow upstream retry or alerting flows.
 */
export async function handleInvoicePaid(db: Database, event: Stripe.Event): Promise<void> {
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

    // Find local subscription by Stripe subscription ID
    const localSub = await db.query.PlanSubscription.findFirst({
      where: (sub, { eq }) => eq(sub.stripeSubscriptionId, stripeSubscriptionId),
    })

    if (!localSub) {
      logger.warn('Subscription not found for invoice', {
        stripeSubscriptionId,
        stripeInvoiceId,
      })
      return
    }

    // Check if invoice already exists
    const existingInvoice = await db.query.Invoice.findFirst({
      where: (inv, { eq }) => eq(inv.stripeInvoiceId, stripeInvoiceId),
    })

    if (existingInvoice) {
      // Update existing invoice
      await db
        .update(schema.Invoice)
        .set({
          status: 'PAID',
          paidDate: new Date(),
          pdfUrl: invoice.invoice_pdf ?? undefined,
          amount: invoice.amount_paid,
          updatedAt: new Date(),
        })
        .where(eq(schema.Invoice.id, existingInvoice.id))

      logger.info('Invoice updated', {
        invoiceId: existingInvoice.id,
        stripeInvoiceId,
      })
    } else {
      // Create new invoice
      await db.insert(schema.Invoice).values({
        organizationId: localSub.organizationId,
        subscriptionId: localSub.id,
        stripeInvoiceId,
        invoiceNumber: invoice.number ?? `INV-${stripeInvoiceId}`,
        amount: invoice.amount_paid,
        status: 'PAID',
        invoiceDate: new Date(invoice.created * 1000),
        dueDate: invoice.due_date ? new Date(invoice.due_date * 1000) : new Date(),
        paidDate: new Date(),
        currency: invoice.currency.toUpperCase(),
        billingReason: invoice.billing_reason ?? undefined,
        pdfUrl: invoice.invoice_pdf ?? undefined,
        updatedAt: new Date(),
      })

      logger.info('Invoice created', {
        stripeInvoiceId,
        organizationId: localSub.organizationId,
      })
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : ''
    logger.error('Stripe webhook failed in invoice paid', { error: message })
    throw error
  }
}
