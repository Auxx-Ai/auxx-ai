// apps/web/src/app/api/apps/shopify/billing-webhook/route.ts

import { getProvider } from '@auxx/billing'
import { database } from '@auxx/database'
import { recordAudit } from '@auxx/lib/audit-log'
import { onCacheEvent } from '@auxx/lib/cache'
import { resolveWebhookSecret, shopifyPreset, verifyWebhook } from '@auxx/lib/webhooks'
import { createScopedLogger } from '@auxx/logger'
import { type NextRequest, NextResponse } from 'next/server'

const logger = createScopedLogger('shopify/billing-webhook')

/**
 * Maps a Shopify billing topic to an audit action. Shopify collapses
 * create/approve/change into one `app_subscriptions/update` topic, so that maps to
 * `subscription.updated`; the only distinct lifecycle signal is uninstall → canceled.
 */
function shopifyBillingAction(topic: string): string | null {
  if (topic === 'app_subscriptions/update') return 'subscription.updated'
  if (topic === 'app/uninstalled') return 'subscription.canceled'
  return null
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const headers = { 'x-shopify-hmac-sha256': req.headers.get('x-shopify-hmac-sha256') ?? '' }
  const secret = await resolveWebhookSecret({ kind: 'env', key: 'SHOPIFY_API_SECRET' })
  if (!verifyWebhook(shopifyPreset, { rawBody, headers, secret })) {
    logger.error('Shopify billing webhook HMAC validation failed')
    return new NextResponse('invalid signature', { status: 401 })
  }

  const topic = req.headers.get('x-shopify-topic') ?? ''
  const shopDomain = req.headers.get('x-shopify-shop-domain') ?? ''

  try {
    const result = await getProvider('shopify').processWebhook({
      db: database,
      rawBody,
      topic,
      shopDomain,
    })
    // Refresh the org's cached subscription/features after a billing state change so the
    // app (and the claim-page short-circuit) sees the new status without waiting on TTL.
    if (result.organizationId) {
      await onCacheEvent('plan.changed', { orgId: result.organizationId })

      const action = shopifyBillingAction(topic)
      if (action) {
        await recordAudit({
          organizationId: result.organizationId,
          category: 'billing',
          action,
          actorType: 'integration',
          actorId: null,
          targetType: 'Subscription',
          targetId: shopDomain || null,
          metadata: { provider: 'shopify', topic, shopDomain },
          context: { ipAddress: null, userAgent: null, sessionId: null },
        })
      }
    }
    return new NextResponse('ok', { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('Shopify billing webhook dispatch failed', { error: message, topic, shopDomain })
    return new NextResponse('processing error', { status: 500 })
  }
}
