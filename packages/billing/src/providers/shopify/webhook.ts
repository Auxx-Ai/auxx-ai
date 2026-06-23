// packages/billing/src/providers/shopify/webhook.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { eq } from 'drizzle-orm'

const logger = createScopedLogger('billing/shopify/webhook')

// Shopify HMAC verification moved to `@auxx/lib/webhooks` (`verifyWebhook(shopifyPreset, …)`).
// Billing is tier-2 and cannot import lib; the only caller was the tier-5 billing-webhook
// route, which now verifies at the edge before delegating here.

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
