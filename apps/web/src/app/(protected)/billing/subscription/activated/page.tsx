// apps/web/src/app/(protected)/billing/subscription/activated/page.tsx

import { getActiveSubscription, getProvider, type ShopifyBillingProvider } from '@auxx/billing'
import { database, schema } from '@auxx/database'
import { onCacheEvent } from '@auxx/lib/cache'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from '~/auth/server'

const logger = createScopedLogger('shopify-billing-activated')

interface PageProps {
  // Shopify appends `?plan_handle=&shop=` to the welcome link on its hosted pricing
  // page. `org` is carried for the legacy/embedded path.
  searchParams: Promise<{ plan_handle?: string; shop?: string; org?: string }>
}

const MAX_ATTEMPTS = 5
const RETRY_DELAY_MS = 1500

/**
 * Post-approval landing route for Shopify App Pricing. The redirect itself isn't signed,
 * so we confirm against the Admin API: resolve the org from `?shop=` (or the session),
 * poll `activeSubscriptions` briefly for propagation lag, then mirror the live contract
 * onto the PlanSubscription row via the provider's `syncFromAdminApi`. If the contract
 * hasn't propagated within the window, the 15-minute worker poll backstops it.
 */
export default async function ShopifySubscriptionActivatedPage({ searchParams }: PageProps) {
  const { plan_handle: planHandle, shop, org } = await searchParams

  const orgRow = await resolveOrgForLanding({ shop, org })
  if (!orgRow?.shopifyShopDomain) {
    logger.warn('Activated landing could not resolve a Shopify org', { shop, org })
    redirect('/app/settings/plans?billing=pending')
  }

  // Poll the Admin API for the contract (handles post-approval propagation lag).
  let confirmed = false
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const sub = await getActiveSubscription({
        shopDomain: orgRow.shopifyShopDomain,
        organizationId: orgRow.organizationId,
      })
      if (sub) {
        confirmed = true
        break
      }
    } catch (err) {
      logger.warn('getActiveSubscription failed on landing', {
        organizationId: orgRow.organizationId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
    if (attempt < MAX_ATTEMPTS - 1) {
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS))
    }
  }

  if (confirmed) {
    try {
      const provider = getProvider('shopify') as ShopifyBillingProvider
      await provider.syncFromAdminApi(orgRow.organizationId, { planHandleHint: planHandle })
      await onCacheEvent('plan.changed', { orgId: orgRow.organizationId })
    } catch (err) {
      logger.error('syncFromAdminApi failed on landing', {
        organizationId: orgRow.organizationId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
    logger.info('Shopify billing activated', {
      organizationId: orgRow.organizationId,
      planHandle: planHandle ?? null,
    })
    redirect('/app')
  }

  // Contract not propagated yet — worker poll will catch up within 15 minutes.
  redirect('/app/settings/plans?billing=pending')
}

/** Resolves the Shopify-billed org for the landing redirect, preferring the `?shop=` param. */
async function resolveOrgForLanding(opts: {
  shop?: string
  org?: string
}): Promise<{ organizationId: string; shopifyShopDomain: string | null } | null> {
  if (opts.shop) {
    const [row] = await database
      .select({
        organizationId: schema.PlanSubscription.organizationId,
        shopifyShopDomain: schema.PlanSubscription.shopifyShopDomain,
      })
      .from(schema.PlanSubscription)
      .where(
        and(
          eq(schema.PlanSubscription.shopifyShopDomain, opts.shop),
          eq(schema.PlanSubscription.billingProvider, 'shopify')
        )
      )
      .limit(1)
    if (row) return row
  }

  // Fallback to the session's default org (embedded / missing-shop case).
  const session = await auth.api.getSession({ headers: await headers() })
  const orgId =
    opts.org ??
    (session?.user as { defaultOrganizationId?: string | null } | undefined)?.defaultOrganizationId
  if (!orgId) return null

  const [row] = await database
    .select({
      organizationId: schema.PlanSubscription.organizationId,
      shopifyShopDomain: schema.PlanSubscription.shopifyShopDomain,
    })
    .from(schema.PlanSubscription)
    .where(eq(schema.PlanSubscription.organizationId, orgId))
    .limit(1)
  return row ?? null
}
