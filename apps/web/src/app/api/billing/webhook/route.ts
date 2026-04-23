// apps/web/src/app/api/billing/webhook/route.ts
/**
 * Stripe webhook handler for billing events.
 */

import { WebhookService } from '@auxx/billing'
import { configService } from '@auxx/credentials'
import { database } from '@auxx/database'
import { isSelfHosted } from '@auxx/deployment'
import { onInvoicePaidRefreshQuota, onSubscriptionUpdatedSyncQuota } from '@auxx/lib/ai/quota'
import { onCacheEvent } from '@auxx/lib/cache'
import { handlePlanDowngrade } from '@auxx/lib/permissions'
import { createScopedLogger } from '@auxx/logger'
import { type NextRequest, NextResponse } from 'next/server'

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

    const webhookService = new WebhookService(
      database,
      configService.get<string>('STRIPE_WEBHOOK_SECRET')!,
      {
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
          logger.info('Subscription created, cache invalidated', { eventId: event.id })
        },
        onSubscriptionUpdated: async (event, ctx) => {
          await onSubscriptionUpdatedSyncQuota(database, event, ctx)
          if (ctx.organizationId) {
            await onCacheEvent('plan.changed', { orgId: ctx.organizationId })
          }
          logger.info('Subscription updated, cache invalidated', { eventId: event.id })
        },
        onSubscriptionDeleted: async (event, ctx) => {
          if (ctx.organizationId) {
            await onCacheEvent('plan.canceled', { orgId: ctx.organizationId })
          }
          logger.info('Subscription deleted, cache invalidated', { eventId: event.id })
        },
        onInvoicePaid: async (event, ctx) => {
          await onInvoicePaidRefreshQuota(database, event, ctx)
          if (ctx.organizationId) {
            await onCacheEvent('plan.changed', { orgId: ctx.organizationId })
          }
          logger.info('Invoice paid, cache invalidated', { eventId: event.id })
        },
        onInvoicePaymentFailed: async (event, ctx) => {
          if (ctx.organizationId) {
            await onCacheEvent('plan.changed', { orgId: ctx.organizationId })
          }
          logger.warn('Invoice payment failed, cache invalidated', { eventId: event.id })
        },
      },
      handlePlanDowngrade
    )

    await webhookService.processWebhook(body, signature)

    return NextResponse.json({ success: true })
  } catch (error: any) {
    logger.error('Webhook error', { error: error.message })
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
}
