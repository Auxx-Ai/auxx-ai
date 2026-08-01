// apps/web/src/app/api/billing/webhook/route.ts
/**
 * Stripe webhook handler for billing events.
 */

import type { ProcessWebhookInput } from '@auxx/billing'
import { getProvider } from '@auxx/billing'
import { configService } from '@auxx/credentials'
import { database } from '@auxx/database'
import { isSelfHosted } from '@auxx/deployment'
import { onInvoicePaidRefreshQuota, onSubscriptionUpdatedSyncQuota } from '@auxx/lib/ai/quota'
import { recordAudit } from '@auxx/lib/audit-log'
import { onCacheEvent } from '@auxx/lib/cache'
import { handlePlanDowngrade } from '@auxx/lib/permissions'
import { verifyStripeSignature } from '@auxx/lib/webhooks'
import { createScopedLogger } from '@auxx/logger'
import { type NextRequest, NextResponse } from 'next/server'

/**
 * Logger scoped to the billing webhook route for structured logs.
 */
const logger = createScopedLogger('billing-webhook')

/**
 * Structural slice of a Stripe event — avoids pulling the `stripe` dep into web.
 * `data.object` stays `unknown`: Stripe's real union of resource interfaces has no
 * index signature, so `Record<string, unknown>` would reject every concrete event.
 * Callers narrow the fields they actually read.
 */
type StripeWebhookEvent = { id: string; type: string; data: { object: unknown } }

/**
 * Append a billing audit row from a Stripe webhook. No user/request context — the
 * provider drove the change (`actorType: 'integration'`). The Stripe event id is stored
 * in metadata so retried (duplicate) webhooks remain detectable. Fire-and-forget safe.
 */
function auditStripeBilling(
  action: string,
  event: StripeWebhookEvent,
  organizationId: string | null,
  targetType: string,
  extraMetadata: Record<string, unknown> = {}
) {
  if (!organizationId) return
  return recordAudit({
    organizationId,
    category: 'billing',
    action,
    actorType: 'integration',
    actorId: null,
    targetType,
    targetId: (event.data.object as { id?: string }).id ?? null,
    metadata: { provider: 'stripe', eventId: event.id, eventType: event.type, ...extraMetadata },
    context: { ipAddress: null, userAgent: null, sessionId: null },
  })
}

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

    // Verify at the edge (tier-5 can import @auxx/lib; billing tier-2 cannot). The
    // shared verifier is SDK-faithful — it enforces the timestamp tolerance window.
    const webhookSecret = configService.get<string>('STRIPE_WEBHOOK_SECRET')
    if (
      !webhookSecret ||
      !verifyStripeSignature({ rawBody: body, header: signature, secret: webhookSecret })
    ) {
      logger.error('Stripe webhook signature verification failed')
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }

    const verifiedEvent = JSON.parse(body) as StripeWebhookEvent

    await getProvider('stripe').processWebhook({
      db: database,
      event: verifiedEvent as unknown as NonNullable<ProcessWebhookInput['event']>,
      handlers: {
        onCheckoutSessionCompleted: async (event, ctx) => {
          if (ctx.organizationId) {
            await onCacheEvent('plan.subscribed', { orgId: ctx.organizationId })
          }
          logger.info('Checkout session completed, cache invalidated', { eventId: event.id })
        },
        onSubscriptionCreated: async (event, ctx) => {
          await onSubscriptionUpdatedSyncQuota(database, event, ctx)
          if (ctx.organizationId) {
            await onCacheEvent('plan.subscribed', { orgId: ctx.organizationId })
          }
          await auditStripeBilling(
            'subscription.activated',
            event,
            ctx.organizationId,
            'Subscription',
            {
              status: (event.data.object as { status?: string }).status ?? null,
            }
          )
          logger.info('Subscription created, cache invalidated', { eventId: event.id })
        },
        onSubscriptionUpdated: async (event, ctx) => {
          await onSubscriptionUpdatedSyncQuota(database, event, ctx)
          if (ctx.organizationId) {
            await onCacheEvent('plan.changed', { orgId: ctx.organizationId })
          }
          await auditStripeBilling(
            'subscription.updated',
            event,
            ctx.organizationId,
            'Subscription',
            {
              status: (event.data.object as { status?: string }).status ?? null,
            }
          )
          logger.info('Subscription updated, cache invalidated', { eventId: event.id })
        },
        onSubscriptionDeleted: async (event, ctx) => {
          if (ctx.organizationId) {
            await onCacheEvent('plan.canceled', { orgId: ctx.organizationId })
          }
          await auditStripeBilling(
            'subscription.canceled',
            event,
            ctx.organizationId,
            'Subscription'
          )
          logger.info('Subscription deleted, cache invalidated', { eventId: event.id })
        },
        onInvoicePaid: async (event, ctx) => {
          await onInvoicePaidRefreshQuota(database, event, ctx)
          if (ctx.organizationId) {
            await onCacheEvent('plan.changed', { orgId: ctx.organizationId })
          }
          await auditStripeBilling('invoice.paid', event, ctx.organizationId, 'Invoice', {
            amountPaid: (event.data.object as { amount_paid?: number }).amount_paid ?? null,
            currency: (event.data.object as { currency?: string }).currency ?? null,
          })
          logger.info('Invoice paid, cache invalidated', { eventId: event.id })
        },
        onInvoicePaymentFailed: async (event, ctx) => {
          if (ctx.organizationId) {
            await onCacheEvent('plan.changed', { orgId: ctx.organizationId })
          }
          await auditStripeBilling('payment.failed', event, ctx.organizationId, 'Invoice', {
            currency: (event.data.object as { currency?: string }).currency ?? null,
          })
          logger.warn('Invoice payment failed, cache invalidated', { eventId: event.id })
        },
      },
      onPlanChange: handlePlanDowngrade,
    })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    logger.error('Webhook error', { error: error.message })
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
}
