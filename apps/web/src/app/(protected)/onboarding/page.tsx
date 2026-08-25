// apps/web/src/app/(protected)/onboarding/page.tsx

import { database, schema } from '@auxx/database'
import { getOrgCache, getUserCache, onCacheEvent } from '@auxx/lib/cache'
import { eq } from 'drizzle-orm'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getSession } from '~/auth/session'

/**
 * Reconcile the cached onboarding flags against the row before bouncing back to
 * `/app`.
 *
 * `/app` gates on the CACHED dehydrated state (`components/global/dashboard.tsx`);
 * this page reads the row. Reaching the `/app` redirect below means the row says
 * onboarding is finished — so the only thing that could have sent the user here
 * is a cache that disagrees. Neither page ever consults the other's source, so
 * that disagreement is an unbounded redirect loop, not a one-time glitch.
 *
 * This loop has now recurred four times, with a different stale writer each time:
 * the better-auth session cookie cache (#317), the demo route's direct Drizzle
 * writes, `userProfile` after better-auth's hookless `updateUser` (#1381), and an
 * invalidation that lost a race against an in-flight recompute in the org cache.
 * Fixing writers one at a time has not ended it, so this is the catch-all: the
 * one place that holds DB truth repairs whatever lied, instead of trusting that
 * every future writer will remember to.
 *
 * Best-effort and never throws — a failure here must not block onboarding, and
 * the bounce guard in `dashboard.tsx` still stops the loop either way.
 */
async function reconcileStaleOnboardingCache(
  userId: string,
  organizationId: string
): Promise<void> {
  try {
    const [{ orgProfile }, { userProfile }] = await Promise.all([
      getOrgCache().getOrRecompute(organizationId, ['orgProfile']),
      getUserCache().getOrRecompute(userId, ['userProfile']),
    ])

    const orgStale = orgProfile?.completedOnboarding === false
    const userStale = userProfile?.completedOnboarding === false
    if (!orgStale && !userStale) return

    console.warn('[Onboarding] Cached onboarding flags disagree with the database, busting:', {
      userId,
      organizationId,
      cachedOrgCompletedOnboarding: orgProfile?.completedOnboarding,
      cachedUserCompletedOnboarding: userProfile?.completedOnboarding,
    })

    if (orgStale) await onCacheEvent('org.updated', { orgId: organizationId })
    if (userStale) await onCacheEvent('user.updated', { orgId: organizationId, userId })
  } catch (error) {
    console.error('[Onboarding] Failed to reconcile cached onboarding flags:', error)
  }
}

/**
 * Onboarding entry point that determines where to redirect the user based on:
 * - Organization's completedOnboarding status
 * - User's completedOnboarding status (for personal info)
 * - Whether the organization has a handle set
 */
export default async function OnboardingPage() {
  const session = await getSession()

  if (!session) {
    redirect('/login')
  }

  // Read defaultOrganizationId directly from DB instead of the session cookie cache.
  // The session cookie is cached for 5 minutes (cookieCache.maxAge) and can serve a stale
  // org ID after switching organizations, causing an infinite redirect loop between
  // /onboarding (which checks the old org) and /app (which checks the new org).
  const [freshUser] = await database
    .select({
      defaultOrganizationId: schema.User.defaultOrganizationId,
      completedOnboarding: schema.User.completedOnboarding,
    })
    .from(schema.User)
    .where(eq(schema.User.id, session.user.id))
    .limit(1)

  const organizationId = freshUser?.defaultOrganizationId ?? null

  // Fetch organization's onboarding status
  let org: { completedOnboarding: boolean | null; handle: string | null } | null = null
  if (organizationId) {
    const [result] = await database
      .select({
        completedOnboarding: schema.Organization.completedOnboarding,
        handle: schema.Organization.handle,
      })
      .from(schema.Organization)
      .where(eq(schema.Organization.id, organizationId))
      .limit(1)
    org = result ?? null
  }

  const userCompletedOnboarding = freshUser?.completedOnboarding ?? false

  console.log('[Onboarding] Entry page routing decision:', {
    userId: session.user.id,
    organizationId,
    orgCompletedOnboarding: org?.completedOnboarding,
    orgHandle: org?.handle,
    userCompletedOnboarding,
  })

  // The personal step is a USER-level gate and is checked first, deliberately above
  // the org short-circuit below. An invited member joins an org that is already
  // onboarded, so any check that starts with the org can never express "the org is
  // done but this person isn't" — it bounces them straight to /app with no name.
  if (!userCompletedOnboarding) {
    console.log('[Onboarding] User has not completed personal step, redirecting to /personal')
    redirect('/onboarding/personal')
  }

  // If organization onboarding is complete, route to /app — unless this user landed
  // here mid-Shopify-App-Store install, in which case finish the claim flow first.
  // Must stay BELOW the user check: an App Store install by a user who hasn't done
  // the personal step goes personal → back here → claim, never straight to /app.
  if (org?.completedOnboarding) {
    const cookieStore = await cookies()
    const claimToken = cookieStore.get('shopify_claim_token')?.value
    if (claimToken) {
      console.log('[Onboarding] Org onboarding complete, claim cookie set, redirecting to claim')
      redirect('/shopify/claim')
    }
    // Repair the cache that sent them here before bouncing back — see
    // `reconcileStaleOnboardingCache`. Must run BEFORE `redirect()`, which throws.
    // `organizationId` is non-null here: `org` is only fetched when it is set.
    if (organizationId) {
      await reconcileStaleOnboardingCache(session.user.id, organizationId)
    }
    console.log('[Onboarding] Org onboarding complete, redirecting to /app')
    redirect('/app')
  }

  // Personal step is done by here. Remaining routing is purely org-shaped.
  if (!org?.handle) {
    // Org needs a handle - step 2
    console.log('[Onboarding] Redirecting to /onboarding/organization')
    redirect('/onboarding/organization')
  }

  // Handle already set (create-org dialog, Shopify claim) - skip to connections (step 3)
  console.log('[Onboarding] Redirecting to /onboarding/connections')
  redirect('/onboarding/connections')
}
