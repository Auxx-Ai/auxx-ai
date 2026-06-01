// apps/web/src/app/(auth)/shopify/claim/page.tsx

import { database, schema } from '@auxx/database'
import { getOrgCache, getUserCache } from '@auxx/lib/cache'
import { DehydrationService } from '@auxx/lib/dehydration'
import { createScopedLogger } from '@auxx/logger'
import { getRedisClient } from '@auxx/redis'
import { eq } from 'drizzle-orm'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from '~/auth/server'
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

  // Cached user→org memberships (one Redis lookup).
  const memberships = await getUserCache().get(session.user.id, 'userMemberships')
  const activeMemberships = memberships.filter((m) => m.status === 'ACTIVE')

  const defaultOrgId =
    (session.user as { defaultOrganizationId?: string | null }).defaultOrganizationId ?? null

  // Short-circuit the picker when this shop is already linked to a single *live*
  // workspace. Shopify's "Open app" re-runs the install → OAuth → claim round-trip on
  // every open, so an already-billed merchant lands here repeatedly; drop them straight
  // into that workspace instead of re-picking it. `incomplete`/`canceled` rows are
  // excluded — those still belong in the picker → finalizeAppStoreInstall flow (resume
  // plan selection / fresh link). A shop attached to >1 live org stays ambiguous → picker.
  const liveLinkedOrgIds: string[] = []
  for (const m of activeMemberships) {
    const sub = await getOrgCache().get(m.organizationId, 'subscription')
    const isLiveLink =
      sub?.billingProvider === 'shopify' &&
      sub.shopifyShopDomain === claim.shop &&
      sub.status !== 'canceled' &&
      sub.status !== 'incomplete'
    if (isLiveLink) {
      liveLinkedOrgIds.push(m.organizationId)
    }
  }

  if (liveLinkedOrgIds.length === 1) {
    const targetOrgId = liveLinkedOrgIds[0]
    // Make the linked workspace active before bouncing into the app, otherwise `/app`
    // would open whatever the user's current default org is.
    if (defaultOrgId !== targetOrgId) {
      await database
        .update(schema.User)
        .set({ defaultOrganizationId: targetOrgId, updatedAt: new Date() })
        .where(eq(schema.User.id, session.user.id))
      await new DehydrationService(database).invalidateUser(session.user.id)
    }
    redirect('/app')
  }

  // A Shopify store can be attached to more than one Auxx org, so show the picker with
  // every workspace the user is in (per-org profile is cached).
  const orgs = await Promise.all(
    activeMemberships.map(async (m) => {
      const profile = await getOrgCache().get(m.organizationId, 'orgProfile')
      return { id: profile.id, name: profile.name, handle: profile.handle }
    })
  )

  return (
    <ClaimFlow
      shop={claim.shop}
      orgs={orgs}
      defaultOrganizationId={defaultOrgId}
      claimToken={claimToken}
    />
  )
}
