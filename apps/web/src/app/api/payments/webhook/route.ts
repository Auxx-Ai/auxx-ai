// apps/web/src/app/api/payments/webhook/route.ts
// Stripe Connect webhook handler (money MP1 build spec §F) — its OWN endpoint + secret
// (`STRIPE_CONNECT_WEBHOOK_SECRET`), separate from `api/billing/webhook` (a different Stripe
// mode/secret/event set, tier-3 handler). Never routes through `@auxx/billing`.

export const runtime = 'nodejs'

import { configService } from '@auxx/credentials'
import { applyStripeEvent } from '@auxx/lib/money'
import { verifyStripeSignature } from '@auxx/lib/webhooks'
import { createScopedLogger } from '@auxx/logger'
import { type NextRequest, NextResponse } from 'next/server'
import type Stripe from 'stripe'

const logger = createScopedLogger('payments-webhook')

/**
 * Handles Stripe Connect webhook events (money MP1 build spec §F): checkout completion,
 * payment success/failure, refunds, disputes, and connected-account state changes. Returns 200
 * fast — `applyStripeEvent` is an idempotent reducer, so a Stripe retry is always safe. Bad
 * signatures 400 (no retry, the payload's untrusted); a thrown processing error 500s so Stripe
 * retries the delivery.
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
    await applyStripeEvent(event)
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
