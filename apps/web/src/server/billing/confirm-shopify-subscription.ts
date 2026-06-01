// apps/web/src/server/billing/confirm-shopify-subscription.ts

import { getActiveSubscription, getProvider, type ShopifyBillingProvider } from '@auxx/billing'
import { onCacheEvent } from '@auxx/lib/cache'
import { createScopedLogger } from '@auxx/logger'

const logger = createScopedLogger('shopify-confirm-subscription')

const DEFAULT_MAX_ATTEMPTS = 5
const RETRY_DELAY_MS = 1500

/**
 * Confirms a Shopify subscription against the Admin API and mirrors it onto the local
 * PlanSubscription row, then busts the org cache.
 *
 * The Managed-Pricing redirect back into the app isn't signed and the `app_subscriptions/update`
 * webhook may not have arrived yet, so we poll `activeSubscriptions` briefly for propagation lag,
 * call `syncFromAdminApi` to write the live contract, and fire `onCacheEvent('plan.changed')` so
 * the org `subscription`/`features`/`overages` caches reflect the new status immediately.
 *
 * Shared by the post-approval landing page (`/billing/subscription/activated`) and the Shopify
 * claim page short-circuit — both need authoritative state right after approval rather than
 * trusting a possibly-stale cached `incomplete`.
 *
 * `maxAttempts` bounds the propagation-lag poll: the landing page can afford the full window, but
 * the claim page passes a smaller value so a merchant who linked-but-hasn't-approved (also an
 * `incomplete` row) doesn't eat the full delay on every app open.
 *
 * @returns `true` when a live contract was confirmed + synced, `false` if it hadn't propagated
 *   within the poll window (the 15-minute worker poll backstops it).
 */
export async function confirmAndSyncShopifySubscription(input: {
  organizationId: string
  shopDomain: string
  planHandle?: string | null
  maxAttempts?: number
}): Promise<boolean> {
  const maxAttempts = input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  let confirmed = false
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const sub = await getActiveSubscription({
        shopDomain: input.shopDomain,
        organizationId: input.organizationId,
      })
      if (sub) {
        confirmed = true
        break
      }
    } catch (err) {
      logger.warn('getActiveSubscription failed', {
        organizationId: input.organizationId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
    if (attempt < maxAttempts - 1) {
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS))
    }
  }

  if (!confirmed) return false

  try {
    const provider = getProvider('shopify') as ShopifyBillingProvider
    await provider.syncFromAdminApi(input.organizationId, { planHandleHint: input.planHandle })
    await onCacheEvent('plan.changed', { orgId: input.organizationId })
    return true
  } catch (err) {
    logger.error('syncFromAdminApi failed', {
      organizationId: input.organizationId,
      error: err instanceof Error ? err.message : String(err),
    })
    return false
  }
}
