// apps/web/src/app/(protected)/onboarding/page.tsx

import { database, schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getSession } from '~/auth/session'

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
