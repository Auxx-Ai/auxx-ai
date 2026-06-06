// apps/web/src/app/(auth)/shopify/claim/page.tsx

import { database, schema } from '@auxx/database'
import { getOrgCache, getUserCache } from '@auxx/lib/cache'
import { createScopedLogger } from '@auxx/logger'
import { getRedisClient } from '@auxx/redis'
import { and, eq } from 'drizzle-orm'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from '~/auth/server'
import { setUserDefaultOrganization } from '~/server/auth/set-default-organization'
import { confirmAndSyncShopifySubscription } from '~/server/billing/confirm-shopify-subscription'
import { ClaimExpired } from './_components/claim-expired'
import { ClaimFlow } from './_components/claim-flow'

const CLAIM_COOKIE_NAME = 'shopify_claim_token'
const logger = createScopedLogger('shopify-claim-page')

interface PageProps {
  searchParams: Promise<{ token?: string }>
}

/**
 * Shopify App Store claim page. Lives outside `(protected)` so we own the
 * unauthenticated bounce explicitly (the (protected) layout strips the
 * deep-link when there is no `auxx-org-deep-link` cookie — that would lose
 * the claim path on sign-in).
 *
 * Token source priority: cookie → `?token=` query param (cross-device fallback,
 * §7.3 of the plan).
 */
export default async function ShopifyClaimPage({ searchParams }: PageProps) {
  const cookieStore = await cookies()
  const queryToken = (await searchParams).token
  const cookieToken = cookieStore.get(CLAIM_COOKIE_NAME)?.value
  const claimToken = cookieToken || queryToken

  // Resolve claimToken before the session check so we can carry it through the
  // login round-trip — cross-device / cross-domain signup loses both the cookie
  // and the original URL, so the callback must reconstruct the ?token= param.
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    const callback = claimToken
      ? `/shopify/claim?token=${encodeURIComponent(claimToken)}`
      : '/shopify/claim'
    redirect(`/login?callbackUrl=${encodeURIComponent(callback)}`)
  }

  if (!claimToken) {
    return <ClaimExpired />
  }

  const redis = await getRedisClient()
  if (!redis) {
    logger.error('Redis unavailable on claim page')
    return <ClaimExpired />
  }

  const raw = await redis.get(`shopify:pending-claim:${claimToken}`)
  if (!raw) {
    return <ClaimExpired />
  }

  const claim = JSON.parse(raw) as { shop: string }

  // Shopify returns the merchant here (via install → OAuth → claim) right after they approve a
  // plan on the hosted Managed Pricing page. The `app_subscriptions/update` webhook that flips the
  // row `incomplete → active` may not have arrived yet, so the short-circuit below would read a
  // stale `incomplete` from cache and re-show the picker. Confirm + sync against the Admin API
  // first (busts the org cache) so the short-circuit sees the live status on the first return.
  const [shopSub] = await database
    .select({
      organizationId: schema.PlanSubscription.organizationId,
      status: schema.PlanSubscription.status,
    })
    .from(schema.PlanSubscription)
    .where(
      and(
        eq(schema.PlanSubscription.shopifyShopDomain, claim.shop),
        eq(schema.PlanSubscription.billingProvider, 'shopify')
      )
    )
    .limit(1)
  if (shopSub?.status === 'incomplete') {
    // Short poll: right after approval the Admin API already reflects the contract, so a couple
    // of attempts catch it without making a not-yet-approved merchant wait the full window.
    await confirmAndSyncShopifySubscription({
      organizationId: shopSub.organizationId,
      shopDomain: claim.shop,
      maxAttempts: 2,
    })
  }

  // Cached user→org memberships (one Redis lookup).
  const memberships = await getUserCache().get(session.user.id, 'userMemberships')
  const activeMemberships = memberships.filter((m) => m.status === 'ACTIVE')

  const defaultOrgId =
    (session.user as { defaultOrganizationId?: string | null }).defaultOrganizationId ?? null

  // Per-org profile + billing for every workspace the user is in (all cached — one Redis
  // lookup each). `stripeBilled` drives the claim copy: an org already on live Stripe
  // billing keeps it (no plan picker), so the flow says "connect" not "pick a plan".
  // `isLiveShopifyLink` short-circuits the picker when the shop is already attached.
  const orgInfos = await Promise.all(
    activeMemberships.map(async (m) => {
      const [profile, sub] = await Promise.all([
        getOrgCache().get(m.organizationId, 'orgProfile'),
        getOrgCache().get(m.organizationId, 'subscription'),
      ])
      const stripeBilled =
        sub?.billingProvider === 'stripe' &&
        sub.status !== 'incomplete' &&
        sub.status !== 'canceled' &&
        sub.status !== 'incomplete_expired'
      const isLiveShopifyLink =
        sub?.billingProvider === 'shopify' &&
        sub.shopifyShopDomain === claim.shop &&
        sub.status !== 'canceled' &&
        sub.status !== 'incomplete'
      return {
        id: profile.id,
        name: profile.name,
        handle: profile.handle,
        stripeBilled,
        isLiveShopifyLink,
      }
    })
  )

  // Short-circuit the picker when this shop is already linked to a single *live*
  // workspace. Shopify's "Open app" re-runs the install → OAuth → claim round-trip on
  // every open, so an already-billed merchant lands here repeatedly; drop them straight
  // into that workspace instead of re-picking it. `incomplete`/`canceled` rows are
  // excluded — those still belong in the picker → finalizeAppStoreInstall flow (resume
  // plan selection / fresh link). A shop attached to >1 live org stays ambiguous → picker.
  const liveLinkedOrgIds = orgInfos.filter((o) => o.isLiveShopifyLink).map((o) => o.id)

  if (liveLinkedOrgIds.length === 1) {
    const targetOrgId = liveLinkedOrgIds[0]
    // Make the linked workspace active before bouncing into the app, otherwise `/app`
    // would open whatever the user's current default org is.
    if (defaultOrgId !== targetOrgId) {
      await setUserDefaultOrganization(database, session.user.id, targetOrgId)
    }
    redirect('/app')
  }

  // A Shopify store can be attached to more than one Auxx org, so show the picker with
  // every workspace the user is in (profile + billing already resolved above).
  const orgs = orgInfos.map((o) => ({
    id: o.id,
    name: o.name,
    handle: o.handle,
    stripeBilled: o.stripeBilled,
  }))

  return (
    <ClaimFlow
      shop={claim.shop}
      orgs={orgs}
      defaultOrganizationId={defaultOrgId}
      claimToken={claimToken}
    />
  )
}
