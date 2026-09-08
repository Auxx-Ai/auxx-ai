// apps/web/src/app/api/banking/webhook/route.ts
// Stripe PLATFORM webhook handler for the bank feed (plans/bank-connection/06 §3) — its OWN
// endpoint + secret (`STRIPE_BANKING_WEBHOOK_SECRET`).
//
// 🛑 It cannot share `api/payments/webhook`. That endpoint is registered with Stripe in
// "connected accounts" delivery mode, and Financial Connections sessions are created with no
// `{ stripeAccount }` (`banking/feed/fc-client.ts`), so FC events are PLATFORM events and never
// arrive there. Delivery mode is fixed per endpoint and Stripe signs per endpoint, so a second
// endpoint at the same URL would fail signature verification against the Connect secret — hence
// a third Stripe secret.

export const runtime = 'nodejs'

import { configService } from '@auxx/credentials'
import { verifyStripeSignature } from '@auxx/lib/webhooks'
import { createScopedLogger } from '@auxx/logger'
import { type NextRequest, NextResponse } from 'next/server'
import type Stripe from 'stripe'

const logger = createScopedLogger('banking-webhook')

/**
 * Handles the four Financial Connections events the bank feed acts on: refreshed transactions,
 * disconnect, deactivate and reactivate. `applyFinancialConnectionsEvent` is an idempotent
 * reducer, so a Stripe redelivery is always safe. Bad signatures 400 (no retry, the payload is
 * untrusted); an event type this endpoint does not handle is a plain 200, not an error; a real
 * processing failure 500s so Stripe retries the delivery.
 */
export async function POST(req: NextRequest) {
  const body = await req.text()
  const signature = req.headers.get('stripe-signature')

  if (!signature) {
    logger.error('Missing stripe-signature header')
    return NextResponse.json({ error: 'No signature' }, { status: 400 })
  }

  const webhookSecret = configService.get<string>('STRIPE_BANKING_WEBHOOK_SECRET')
  if (
    !webhookSecret ||
    !verifyStripeSignature({ rawBody: body, header: signature, secret: webhookSecret })
  ) {
    logger.error('Stripe banking webhook signature verification failed')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const event = JSON.parse(body) as Stripe.Event

  // Lazy-imported so this route never statically pulls the connector engine into web's module
  // graph. The membership test and the handler both come from `banking/feed/webhook.ts`, so the
  // event-type list and the code that implements it cannot drift.
  const { applyFinancialConnectionsEvent, isFinancialConnectionsEvent } = await import(
    '@auxx/lib/banking'
  )

  if (!isFinancialConnectionsEvent(event.type)) return NextResponse.json({ success: true })

  try {
    await applyFinancialConnectionsEvent(
      event as unknown as Parameters<typeof applyFinancialConnectionsEvent>[0]
    )
  } catch (error) {
    logger.error('Banking webhook processing failed', {
      eventId: event.id,
      eventType: event.type,
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
