// apps/web/src/app/(protected)/app/onboarding/page.tsx

import { auth } from '~/auth/server'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'

export default async function OnboardingPage() {
  const session = await auth.api.getSession({ headers: await headers() })

  if (!session) {
    // If no session, redirect to login page
    redirect('/login')
  }

  // If user already completed onboarding, redirect to dashboard
  if (session?.user.completedOnboarding) {
    redirect('/app')
    return null
  }

  // Redirect to the first step of onboarding
  redirect('/app/onboarding/personal')
}
