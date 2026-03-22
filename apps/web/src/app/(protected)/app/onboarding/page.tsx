// apps/web/src/app/(protected)/app/onboarding/page.tsx

import { database, schema } from '@auxx/database'
import { eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from '~/auth/server'

/**
 * Onboarding entry point that determines where to redirect the user based on:
 * - Organization's completedOnboarding status
 * - User's completedOnboarding status (for personal info)
 * - Whether the organization has a handle set
 */
export default async function OnboardingPage() {
  const session = await auth.api.getSession({ headers: await headers() })

  if (!session) {
    redirect('/login')
  }

  // Read defaultOrganizationId directly from DB instead of the session cookie cache.
  // The session cookie is cached for 5 minutes (cookieCache.maxAge) and can serve a stale
  // org ID after switching organizations, causing an infinite redirect loop between
  // /app/onboarding (which checks the old org) and /app (which checks the new org).
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

  // If organization onboarding is complete, go to dashboard
  if (org?.completedOnboarding) {
    redirect('/app')
  }

  // Determine starting step based on user and org status
  const userCompletedOnboarding = freshUser?.completedOnboarding ?? false

  if (!userCompletedOnboarding) {
    // User hasn't completed personal info - start at step 1
    redirect('/app/onboarding/personal')
  } else if (!org?.handle) {
    // User completed personal but org needs handle - start at step 2
    redirect('/app/onboarding/organization')
  } else {
    // Both user personal and org handle done - skip to connections (step 3)
    redirect('/app/onboarding/connections')
  }
}
