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

/** Resolves the org that owns a shop from the denormalized PlanSubscription row. */
export async function resolveOrgIdByShopDomain(
  db: Database,
  shopDomain: string
): Promise<string | null> {
  if (!shopDomain) return null
  const row = await db.query.PlanSubscription.findFirst({
    where: (s, { eq: e }) => e(s.shopifyShopDomain, shopDomain),
    columns: { organizationId: true },
  })
  return row?.organizationId ?? null
}

/**
 * Cancels the Shopify subscription for a shop. Used on `app/uninstalled` — the access
 * token is revoked at uninstall, so we cannot read the Admin API and must mark the row
 * canceled directly.
 */
export async function cancelSubscriptionByShop(db: Database, shopDomain: string): Promise<void> {
  if (!shopDomain) {
    logger.warn('Uninstall webhook with no shopDomain header')
    return
  }
  const now = new Date()
  const result = await db
    .update(schema.PlanSubscription)
    .set({ status: 'canceled', canceledAt: now, updatedAt: now })
    .where(eq(schema.PlanSubscription.shopifyShopDomain, shopDomain))
    .returning({ id: schema.PlanSubscription.id })

  logger.info('Shopify subscription canceled on uninstall', {
    shopDomain,
    rowsUpdated: result.length,
  })
}
