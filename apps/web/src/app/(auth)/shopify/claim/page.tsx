// apps/web/src/app/(auth)/shopify/claim/page.tsx

import { getOrgCache, getUserCache } from '@auxx/lib/cache'
import { createScopedLogger } from '@auxx/logger'
import { getRedisClient } from '@auxx/redis'
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

  // Cached user→org memberships (one Redis lookup) + per-org profile (cached).
  // A Shopify store can be attached to more than one Auxx org, so we always show
  // the picker with every workspace the user is in.
  const memberships = await getUserCache().get(session.user.id, 'userMemberships')
  const activeMemberships = memberships.filter((m) => m.status === 'ACTIVE')
  const orgs = await Promise.all(
    activeMemberships.map(async (m) => {
      const profile = await getOrgCache().get(m.organizationId, 'orgProfile')
      return { id: profile.id, name: profile.name, handle: profile.handle }
    })
  )

  const defaultOrgId =
    (session.user as { defaultOrganizationId?: string | null }).defaultOrganizationId ?? null

  return (
    <ClaimFlow
      shop={claim.shop}
      orgs={orgs}
      defaultOrganizationId={defaultOrgId}
      claimToken={claimToken}
    />
  )
}
