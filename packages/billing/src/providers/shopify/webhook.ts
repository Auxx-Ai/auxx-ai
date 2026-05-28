// packages/billing/src/providers/shopify/webhook.ts

import { createHmac, timingSafeEqual } from 'node:crypto'
import { configService } from '@auxx/credentials'
import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { eq } from 'drizzle-orm'

const logger = createScopedLogger('billing/shopify/webhook')

/** Verifies a Shopify webhook payload against the X-Shopify-Hmac-Sha256 header. */
export function verifyShopifyHmac(rawBody: string, hmacHeader: string | null | undefined): boolean {
  const secret = configService.get<string>('SHOPIFY_API_SECRET')
  if (!secret) {
    logger.error('SHOPIFY_API_SECRET not configured')
    return false
  }
  if (!hmacHeader) return false
  const computed = createHmac('sha256', secret).update(rawBody).digest('base64')
  if (computed.length !== hmacHeader.length) return false
  try {
    return timingSafeEqual(Buffer.from(computed), Buffer.from(hmacHeader))
  } catch {
    return false
  }
}

export interface DispatchShopifyWebhookInput {
  db: Database
  rawBody: string
  topic: string
  shopDomain: string
}

export async function dispatchShopifyBillingWebhook(
  input: DispatchShopifyWebhookInput
): Promise<{ success: boolean }> {
  const { db, topic, shopDomain } = input

  switch (topic) {
    case 'APP_UNINSTALLED':
      return handleAppUninstalled(db, shopDomain)
    default:
      // App Pricing delivers no billing webhooks to apps enrolled after April 2026.
      // Subscription state changes are read from the Admin API (see provider's
      // syncFromAdminApi + the worker poll). Uninstall is the only kept webhook.
      logger.info('Unhandled Shopify billing webhook topic', { topic })
      return { success: true }
  }
}

async function handleAppUninstalled(
  db: Database,
  shopDomain: string
): Promise<{ success: boolean }> {
  if (!shopDomain) {
    logger.warn('APP_UNINSTALLED with no shopDomain header')
    return { success: true }
  }
  const now = new Date()
  const result = await db
    .update(schema.PlanSubscription)
    .set({ status: 'canceled', canceledAt: now, updatedAt: now })
    .where(eq(schema.PlanSubscription.shopifyShopDomain, shopDomain))
    .returning({ id: schema.PlanSubscription.id })

  logger.info('APP_UNINSTALLED fan-out applied', { shopDomain, rowsUpdated: result.length })
  return { success: true }
}
