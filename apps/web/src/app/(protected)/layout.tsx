// apps/web/src/app/(protected)/layout.tsx

import { DehydrationService } from '@auxx/lib/dehydration'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import Script from 'next/script'
import type { ReactNode } from 'react'
import { auth } from '~/auth/server'
import { DehydratedStateProvider } from '~/providers/dehydrated-state-provider'
import { FeatureFlagProvider, OrganizationIdProvider } from '~/providers/feature-flag-provider'
import { PostHogProvider } from '~/providers/posthog-provider'

interface ProtectedLayoutProps {
  children: ReactNode
}

/**
 * Parent layout for all protected routes.
 * Handles auth, dehydration, and provides context to all child route groups.
 */
export default async function ProtectedLayout({ children }: ProtectedLayoutProps) {
  const session = await auth.api.getSession({ headers: await headers() })

  // Require authentication — preserve deep link through login flow
  if (!session?.user) {
    const cookieStore = await cookies()
    const deepLink = cookieStore.get('auxx-org-deep-link')?.value
    if (deepLink) {
      redirect(`/login?callbackUrl=${encodeURIComponent(deepLink)}`)
    }
    redirect('/login')
  }

  // Block banned users
  if ((session.user as any).banned) {
    redirect('/deactivated')
  }

  // Force password change if flagged by admin
  if ((session.user as any).forcePasswordChange) {
    redirect('/change-password?forced=true')
  }

  // Fetch dehydrated state on server with error handling
  const dehydrationService = new DehydrationService()
  let dehydratedState
  try {
    dehydratedState = await dehydrationService.getState(session.user.id)
  } catch (error) {
    console.error('Failed to fetch dehydrated state:', error)
    redirect('/error?message=failed-to-load-state')
  }

  // Check if demo session has expired
  const currentOrg = dehydratedState.organizations.find(
    (o) => o.id === dehydratedState.organizationId
  )
  if (currentOrg?.demoExpiresAt && new Date(currentOrg.demoExpiresAt) < new Date()) {
    redirect('/demo-expired')
  }

  return (
    <>
      {/* Inject dehydrated state into window BEFORE React hydration */}
      <Script
        id='dehydrated-state'
        strategy='beforeInteractive'
        dangerouslySetInnerHTML={{
          __html: `window.AUXX_DEHYDRATED_STATE = ${JSON.stringify(dehydratedState).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')};`,
        }}
      />

      <DehydratedStateProvider initialState={dehydratedState}>
        <OrganizationIdProvider>
          <FeatureFlagProvider>
            <PostHogProvider>{children}</PostHogProvider>
          </FeatureFlagProvider>
        </OrganizationIdProvider>
      </DehydratedStateProvider>
    </>
  )
}
