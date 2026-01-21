// apps/web/src/app/(protected)/app/onboarding/page.tsx

import { auth } from '~/auth/server'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { database, schema } from '@auxx/database'
import { eq } from 'drizzle-orm'

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

  const user = session.user as typeof session.user & { defaultOrganizationId?: string | null }
  const organizationId = user.defaultOrganizationId

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
  const userCompletedOnboarding = user.completedOnboarding ?? false

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
