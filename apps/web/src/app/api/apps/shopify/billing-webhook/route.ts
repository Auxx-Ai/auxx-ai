// apps/web/src/app/api/apps/shopify/billing-webhook/route.ts

import { getProvider, verifyShopifyHmac } from '@auxx/billing'
import { database } from '@auxx/database'
import { onCacheEvent } from '@auxx/lib/cache'
import { createScopedLogger } from '@auxx/logger'
import { type NextRequest, NextResponse } from 'next/server'

const logger = createScopedLogger('shopify/billing-webhook')

export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const hmac = req.headers.get('x-shopify-hmac-sha256')
  if (!verifyShopifyHmac(rawBody, hmac)) {
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
    }
    return new NextResponse('ok', { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('Shopify billing webhook dispatch failed', { error: message, topic, shopDomain })
    return new NextResponse('processing error', { status: 500 })
  }
}
