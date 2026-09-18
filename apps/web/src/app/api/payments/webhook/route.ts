// apps/web/src/app/api/payments/webhook/route.ts
// The Stripe Connect webhook endpoint — its OWN secret (`STRIPE_CONNECT_WEBHOOK_SECRET`),
// separate from `api/billing/webhook` (a different Stripe mode, secret and event set).

export const runtime = 'nodejs'

import { configService } from '@auxx/credentials'
import { applyStripeCheckoutEvent } from '@auxx/lib/accounting/money'
import { verifyStripeSignature } from '@auxx/lib/webhooks'
import { createScopedLogger } from '@auxx/logger'
import { type NextRequest, NextResponse } from 'next/server'
import type Stripe from 'stripe'

const logger = createScopedLogger('payments-webhook')

/**
 * Records a confirmed online payment against the invoice or quote it was taken for.
 * `applyStripeCheckoutEvent` is idempotent on the payment intent, so a Stripe retry — or the
 * second of the two events one Checkout payment produces — is always safe. A bad signature
 * 400s (no retry, the payload is untrusted); a processing error 500s so Stripe retries.
 */
export async function POST(req: NextRequest) {
  const body = await req.text()
  const signature = req.headers.get('stripe-signature')

  if (!signature) {
    logger.error('Missing stripe-signature header')
    return NextResponse.json({ error: 'No signature' }, { status: 400 })
  }

  const webhookSecret = configService.get<string>('STRIPE_CONNECT_WEBHOOK_SECRET')
  if (
    !webhookSecret ||
    !verifyStripeSignature({ rawBody: body, header: signature, secret: webhookSecret })
  ) {
    logger.error('Stripe Connect webhook signature verification failed')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const event = JSON.parse(body) as Stripe.Event

  try {
    await applyStripeCheckoutEvent(event)
  } catch (error) {
    logger.error('Payments webhook processing failed', {
      eventId: event.id,
      eventType: event.type,
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
