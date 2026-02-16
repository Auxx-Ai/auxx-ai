// apps/web/src/app/api/billing/webhook/route.ts
/**
 * Stripe webhook handler for billing events.
 */

import { WebhookService } from '@auxx/billing'
import { env } from '@auxx/config/server'
import { database } from '@auxx/database'
import { isSelfHosted } from '@auxx/deployment'
import { createScopedLogger } from '@auxx/logger'
import { type NextRequest, NextResponse } from 'next/server'
import '~/lib/stripe' // Initialize Stripe client

/**
 * Logger scoped to the billing webhook route for structured logs.
 */
const logger = createScopedLogger('billing-webhook')

/**
 * Handles Stripe webhook events to keep billing data in sync.
 *
 * @param req - Incoming Next.js request containing the raw Stripe payload.
 * @returns Stripe-compatible JSON response describing success or failure.
 */
export async function POST(req: NextRequest) {
  if (isSelfHosted()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  try {
    const body = await req.text()
    const signature = req.headers.get('stripe-signature')
    logger.info('process stripe webhook')

    if (!signature) {
      logger.error('Missing stripe-signature header')
      return NextResponse.json({ error: 'No signature' }, { status: 400 })
    }

    const webhookService = new WebhookService(database, env.STRIPE_WEBHOOK_SECRET!, {
      /**
       * Logs successful invoice payments for observability.
       */
      onInvoicePaid: async (event) => {
        logger.info('Invoice paid event processed', { eventId: event.id })
      },
      /**
       * Warns about failed invoice payments so they can be retried manually.
       */
      onInvoicePaymentFailed: async (event) => {
        logger.warn('Invoice payment failed', { eventId: event.id })
      },
    })

    await webhookService.processWebhook(body, signature)

    return NextResponse.json({ success: true })
  } catch (error: any) {
    logger.error('Webhook error', { error: error.message })
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
}
