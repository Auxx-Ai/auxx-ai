// apps/web/src/app/(protected)/billing/subscription/activated/page.tsx

import { database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import { redirect } from 'next/navigation'
import { getSession } from '~/auth/session'
import { confirmAndSyncShopifySubscription } from '~/server/billing/confirm-shopify-subscription'

const logger = createScopedLogger('shopify-billing-activated')

interface PageProps {
  // Shopify appends `?plan_handle=&shop=` to the welcome link on its hosted pricing
  // page. `org` is carried for the legacy/embedded path.
  searchParams: Promise<{ plan_handle?: string; shop?: string; org?: string }>
}

/**
 * Post-approval landing route for Shopify App Pricing. The redirect itself isn't signed,
 * so we confirm against the Admin API: resolve the org from `?shop=` (or the session), then
 * confirm + sync the live contract onto the PlanSubscription row (shared
 * `confirmAndSyncShopifySubscription`). If the contract hasn't propagated within the window,
 * the 15-minute worker poll backstops it.
 */
export default async function ShopifySubscriptionActivatedPage({ searchParams }: PageProps) {
  const { plan_handle: planHandle, shop, org } = await searchParams

  const orgRow = await resolveOrgForLanding({ shop, org })
  if (!orgRow?.shopifyShopDomain) {
    logger.warn('Activated landing could not resolve a Shopify org', { shop, org })
    redirect('/app/settings/plans?billing=pending')
  }

  const confirmed = await confirmAndSyncShopifySubscription({
    organizationId: orgRow.organizationId,
    shopDomain: orgRow.shopifyShopDomain,
    planHandle,
  })

  if (confirmed) {
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
  const session = await getSession()
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
